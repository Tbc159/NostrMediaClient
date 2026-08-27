import type { AuthSigner, PublishResponse, RelayPool } from 'applesauce-relay'

import type { NostrEvent } from '../kinds/types.js'
import { mergeRelayLists } from './pool.js'

/**
 * Pubblicazione di un evento sui relay.
 *
 * Su Nostr non esiste "pubblicato" in senso assoluto: esiste un elenco di
 * relay, ciascuno dei quali accetta o rifiuta per conto proprio. Non c'e'
 * transazione, non c'e' rollback, e un relay puo' accettare l'evento e
 * dimenticarlo il giorno dopo. Questo modulo restituisce percio' l'esito
 * **per relay**, e lascia alla UI il compito di dirlo all'utente invece di
 * ridurre tutto a un booleano che nasconde meta' della verita'.
 */

/** Esito di una pubblicazione su un singolo relay. */
export type EsitoRelay =
  /** Accettato e memorizzato. */
  | 'accettato'
  /** Il relay lo aveva gia': per l'utente equivale a un successo. */
  | 'duplicato'
  /** Rifiutato per una regola del relay (permessi, spam, proof-of-work). */
  | 'rifiutato'
  /** Il relay pretende l'autenticazione NIP-42 e non e' stato possibile darla. */
  | 'autenticazione'
  /** Connessione fallita, scaduta, o errore non attribuibile all'evento. */
  | 'irraggiungibile'

export interface RisultatoRelay {
  url: string
  esito: EsitoRelay
  /** Testo pronto da mostrare, gia' tradotto dal prefisso NIP-01. */
  motivo: string
  /** Messaggio grezzo del relay, per la diagnostica. */
  messaggio?: string
}

export interface RisultatoPubblicazione {
  evento: NostrEvent
  risultati: RisultatoRelay[]
  /** Relay che hanno l'evento (accettato o gia' presente). */
  accettati: string[]
  /**
   * Vero se **almeno un** relay ha l'evento.
   *
   * La soglia e' uno perche' un evento presente su un solo relay e' comunque
   * raggiungibile e replicabile; pretendere l'unanimita' farebbe fallire la
   * pubblicazione ogni volta che un relay qualsiasi e' giu'.
   */
  riuscita: boolean
}

/**
 * Spiega un messaggio OK del relay secondo i prefissi standardizzati da NIP-01.
 *
 * Attenzione all'ordine: **e' il booleano a dire se l'evento e' stato
 * accettato, non il prefisso**. `pow:` e `duplicate:` compaiono anche su
 * risposte positive, e leggere solo il prefisso porterebbe a segnalare come
 * fallita una pubblicazione riuscita.
 */
export function spiegaRispostaRelay(
  ok: boolean,
  messaggio: string | undefined,
): { esito: EsitoRelay; motivo: string } {
  const testo = (messaggio ?? '').trim()
  const prefisso = testo.includes(':') ? testo.slice(0, testo.indexOf(':')).toLowerCase() : ''
  const dettaglio = testo.includes(':') ? testo.slice(testo.indexOf(':') + 1).trim() : testo

  if (ok) {
    if (prefisso === 'duplicate') {
      return { esito: 'duplicato', motivo: 'Il relay aveva gia’ questo evento.' }
    }
    return { esito: 'accettato', motivo: 'Accettato.' }
  }

  switch (prefisso) {
    case 'auth-required':
      return {
        esito: 'autenticazione',
        motivo: `Il relay richiede l’autenticazione NIP-42${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'restricted':
      return {
        esito: 'rifiutato',
        motivo: `Il relay non ti consente di scrivere${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'blocked':
      return {
        esito: 'rifiutato',
        motivo: `Bloccato dal relay${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'rate-limited':
      return {
        esito: 'rifiutato',
        motivo: `Troppe richieste, il relay ha rallentato la scrittura${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'pow':
      return {
        esito: 'rifiutato',
        motivo: `Il relay pretende una proof-of-work che questo client non calcola${dettaglio ? ` (${dettaglio})` : ''}.`,
      }
    case 'invalid':
      return {
        esito: 'rifiutato',
        motivo: `Il relay considera l’evento malformato${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'mute':
      return {
        esito: 'rifiutato',
        motivo: `Ignorato dal relay${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    case 'error':
      return {
        esito: 'irraggiungibile',
        motivo: `Errore del relay${dettaglio ? `: ${dettaglio}` : '.'}`,
      }
    default:
      // Un relay puo' rispondere senza prefisso: la specifica lo impone ma non
      // tutti lo rispettano. Il testo grezzo e' comunque meglio di "errore".
      return { esito: 'rifiutato', motivo: testo.length > 0 ? testo : 'Rifiutato senza motivo.' }
  }
}

export interface OpzioniPubblicazione {
  /**
   * Tempo massimo per relay, in millisecondi.
   *
   * Serve anche a proteggere da un caso preciso: un relay che pretende NIP-42
   * lascia la pubblicazione **in attesa** finche' non arriva l'autenticazione.
   * Senza un tetto, il pulsante resterebbe a girare per sempre.
   */
  timeoutMs?: number

  /**
   * Firmatario per l'autenticazione NIP-42.
   *
   * Viene usato **solo qui, in pubblicazione**, mai in lettura. Autenticarsi
   * significa dire al relay chi sei: quando gli stai gia' consegnando un
   * evento firmato con quella chiave non aggiungi nulla, mentre farlo in
   * lettura gli rivelerebbe cosa leggi e quando.
   */
  auth?: AuthSigner
}

const TIMEOUT_PREDEFINITO = 12_000

/**
 * Invia un evento gia' firmato a un elenco di relay.
 *
 * Non lancia mai per il fallimento di un relay: un rifiuto e' un dato, non
 * un'eccezione. Lancia solo se l'elenco e' vuoto, che e' un errore di
 * configurazione del chiamante.
 */
export async function publishEvent(
  pool: RelayPool,
  relays: readonly string[],
  event: NostrEvent,
  opzioni: OpzioniPubblicazione = {},
): Promise<RisultatoPubblicazione> {
  const destinazioni = mergeRelayLists(relays)
  if (destinazioni.length === 0) {
    throw new Error(
      'Nessun relay di scrittura configurato: non c’e’ dove pubblicare. Controlla le impostazioni.',
    )
  }

  const timeout = opzioni.timeoutMs ?? TIMEOUT_PREDEFINITO

  const risultati = await Promise.all(
    destinazioni.map((url) => pubblicaSuUno(pool, url, event, timeout, opzioni.auth)),
  )

  const accettati = risultati
    .filter((r) => r.esito === 'accettato' || r.esito === 'duplicato')
    .map((r) => r.url)

  return { evento: event, risultati, accettati, riuscita: accettati.length > 0 }
}

/** Pubblica su un solo relay, gestendo autenticazione e scadenza. */
async function pubblicaSuUno(
  pool: RelayPool,
  url: string,
  event: NostrEvent,
  timeoutMs: number,
  auth: AuthSigner | undefined,
): Promise<RisultatoRelay> {
  const relay = pool.relay(url)

  // Se il relay ha gia' fatto sapere che pretende l'autenticazione, la si
  // fornisce prima di provare: altrimenti la publish resterebbe appesa in
  // attesa e verrebbe chiusa solo dalla scadenza.
  if (auth && relay.challenge !== null && !relay.authenticated) {
    try {
      await relay.authenticate(auth)
    } catch {
      // L'esito della pubblicazione dira' se mancava davvero: fermarsi qui
      // impedirebbe di pubblicare su un relay che l'AUTH non la esigeva.
    }
  }

  try {
    const risposta = await conScadenza(relay.publish(event, { timeout: timeoutMs }), timeoutMs, url)
    const { esito, motivo } = spiegaRispostaRelay(risposta.ok, risposta.message)

    // Alcuni relay mandano la sfida solo dopo aver visto un EVENT: al primo
    // tentativo rispondono `auth-required`, e solo ora possiamo autenticarci.
    if (esito === 'autenticazione' && auth) {
      const riprovato = await autenticaERiprova(relay, event, timeoutMs, auth, url)
      if (riprovato) return riprovato
    }

    return {
      url,
      esito,
      motivo,
      ...(risposta.message ? { messaggio: risposta.message } : {}),
    }
  } catch (errore) {
    return {
      url,
      esito: 'irraggiungibile',
      motivo: descriviErrore(errore, url, relay.challenge !== null && !relay.authenticated),
    }
  }
}

/** Secondo tentativo dopo un `auth-required`. */
async function autenticaERiprova(
  relay: ReturnType<RelayPool['relay']>,
  event: NostrEvent,
  timeoutMs: number,
  auth: AuthSigner,
  url: string,
): Promise<RisultatoRelay | null> {
  try {
    const esitoAuth = await relay.authenticate(auth)
    if (!esitoAuth.ok) {
      return {
        url,
        esito: 'autenticazione',
        motivo: `Il relay ha rifiutato l’autenticazione${esitoAuth.message ? `: ${esitoAuth.message}` : '.'}`,
      }
    }
    const risposta = await conScadenza(relay.publish(event, { timeout: timeoutMs }), timeoutMs, url)
    const { esito, motivo } = spiegaRispostaRelay(risposta.ok, risposta.message)
    return {
      url,
      esito,
      motivo,
      ...(risposta.message ? { messaggio: risposta.message } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Applica una scadenza a una promise.
 *
 * `relay.publish` accetta gia' un `timeout`, ma quella scadenza copre l'attesa
 * dell'OK, non l'attesa dell'autenticazione: senza questo secondo tetto un
 * relay che pretende NIP-42 lascerebbe la promise irrisolta.
 */
function conScadenza<T>(promise: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const scadenza = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Nessuna risposta da ${url} entro ${ms / 1000}s.`)),
      ms,
    )
  })
  return Promise.race([promise, scadenza]).finally(() => clearTimeout(timer)) as Promise<T>
}

function descriviErrore(errore: unknown, url: string, attesaAuth: boolean): string {
  const testo = errore instanceof Error ? errore.message : String(errore)
  if (attesaAuth) {
    return `${url} ha chiesto l’autenticazione NIP-42 e la pubblicazione e’ rimasta in attesa. Accedi con una chiave che possa firmare.`
  }
  return testo
}

export type { PublishResponse }
