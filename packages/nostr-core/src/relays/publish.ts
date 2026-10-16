import type { AuthSigner, PublishResponse, RelayPool } from 'applesauce-relay'

import { classifyKind } from '../kinds/classify.js'
import type { NostrEvent } from '../kinds/types.js'
import { mergeRelayLists } from './pool.js'

/**
 * Publishing an event to the relays.
 *
 * On Nostr there is no "published" in an absolute sense: there is a list of
 * relays, each of which accepts or refuses on its own. There is no
 * transaction, no rollback, and a relay can accept the event and forget it the
 * next day. This module therefore returns the outcome **per relay**, and
 * leaves the UI the job of telling the user, instead of reducing everything to
 * a boolean that hides half the truth.
 */

/** The outcome of a publication on a single relay. */
export type EsitoRelay =
  /** Accepted and stored. */
  | 'accettato'
  /** The relay had it already: for the user that amounts to a success. */
  | 'duplicato'
  /** Refused by a rule of the relay's (permissions, spam, proof-of-work). */
  | 'rifiutato'
  /** The relay demands NIP-42 authentication and it could not be given. */
  | 'autenticazione'
  /** The connection failed or timed out, or an error not attributable to the event. */
  | 'irraggiungibile'
  /** Never contacted: an earlier relay had already taken the event on. */
  | 'non tentato'

/**
 * How to distribute the event among the relays on the list.
 *
 * - `sequenziale` — one at a time, in order, stopping at the first that takes
 *   it on. It is the most reliable way: it opens one connection at a time, so
 *   it runs into neither the relays' per-IP limits nor the browser's on the
 *   number of WebSockets open together.
 * - `tutti` — all of them in parallel. Faster and more redundant, but if the
 *   first attempt opens five connections at once it is also the easiest way to
 *   see some of them fail.
 *
 * The trade-off is real and has no single answer: `sequenziale` puts the event
 * on **one** relay, hence less reachable by whoever does not read it; `tutti`
 * puts it everywhere, but fails more often. That is why the choice stays with
 * the caller instead of being hard-wired here.
 */
export type StrategiaPubblicazione = 'sequenziale' | 'tutti'

/**
 * The kinds that go **everywhere**, whatever strategy the user has chosen.
 *
 * The rotation makes sense for a note: it is on one relay, and whoever looks
 * for it finds it by relay hint. Not for a podcast: a podcast player reads
 * from a relay of its own, it does not ask you where you published — and a
 * show whose card is on `nos.lol` is invisible to whoever reads
 * `relay.damus.io`. It happened, and it is the reason for this list.
 */
export const KIND_OVUNQUE: readonly number[] = [54, 10064, 10154]

/**
 * The strategy actually to use for an event.
 *
 * The user's preferred one holds for regular events; for the replaceable and
 * the addressable ones — profile, lists, the podcast's card, articles — and
 * for the kinds in `KIND_OVUNQUE` we go to every relay: these are events that
 * have to be *found*, not merely to exist somewhere.
 */
export function strategiaPerKind(
  kind: number,
  preferita: StrategiaPubblicazione,
): StrategiaPubblicazione {
  if (preferita === 'tutti') return 'tutti'
  const classe = classifyKind(kind)
  if (classe === 'replaceable' || classe === 'addressable') return 'tutti'
  if (KIND_OVUNQUE.includes(kind)) return 'tutti'
  return preferita
}

export interface RisultatoRelay {
  url: string
  esito: EsitoRelay
  /** Text ready to show, already translated from the NIP-01 prefix. */
  motivo: string
  /** The relay's raw message, for diagnostics. */
  messaggio?: string
}

export interface RisultatoPubblicazione {
  evento: NostrEvent
  risultati: RisultatoRelay[]
  /** The relays that have the event (accepted, or there already). */
  accettati: string[]
  /**
   * True when **at least one** relay has the event.
   *
   * The threshold is one because an event present on a single relay is
   * reachable and replicable all the same; demanding unanimity would make the
   * publication fail every time any one relay is down.
   */
  riuscita: boolean
}

/**
 * Explains a relay's OK message according to the prefixes NIP-01 standardises.
 *
 * Mind the order: **it is the boolean that says whether the event was
 * accepted, not the prefix**. `pow:` and `duplicate:` appear on positive
 * answers too, and reading the prefix alone would lead to reporting a
 * successful publication as failed.
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
      // A relay can answer without a prefix: the specification requires one
      // but not everyone follows it. The raw text still beats "error".
      return { esito: 'rifiutato', motivo: testo.length > 0 ? testo : 'Rifiutato senza motivo.' }
  }
}

export interface OpzioniPubblicazione {
  /**
   * The maximum time per relay, in milliseconds.
   *
   * It also protects against one specific case: a relay that demands NIP-42
   * leaves the publication **pending** until the authentication arrives.
   * Without a ceiling, the button would spin for ever.
   */
  timeoutMs?: number

  /**
   * The signer for NIP-42 authentication.
   *
   * It is used **only here, when publishing**, never when reading.
   * Authenticating means telling the relay who you are: when you are already
   * handing it an event signed with that key you add nothing, whereas doing it
   * when reading would reveal to it what you read and when.
   */
  auth?: AuthSigner

  /** The distribution among the relays. The default: `sequenziale`. */
  strategia?: StrategiaPubblicazione

  /** Announces the relay being tried, to give feedback during the wait. */
  onTentativo?: (url: string, indice: number, totale: number) => void
}

const TIMEOUT_PREDEFINITO = 12_000

/**
 * Sends an already signed event to a list of relays.
 *
 * It never throws because a relay failed: a refusal is a piece of data, not an
 * exception. It throws only when the list is empty, which is a configuration
 * error on the caller's side.
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
  const strategia = opzioni.strategia ?? 'sequenziale'

  const risultati =
    strategia === 'tutti'
      ? await Promise.all(
          destinazioni.map((url, i) => {
            opzioni.onTentativo?.(url, i, destinazioni.length)
            return pubblicaSuUno(pool, url, event, timeout, opzioni.auth)
          }),
        )
      : await aRotazione(pool, destinazioni, event, timeout, opzioni)

  const accettati = risultati.filter(preso).map((r) => r.url)

  return { evento: event, risultati, accettati, riuscita: accettati.length > 0 }
}

/** Whether the relay has the event, however it got there. */
const preso = (r: RisultatoRelay): boolean => r.esito === 'accettato' || r.esito === 'duplicato'

/**
 * Tries the relays one at a time, in order, stopping at the first that takes
 * the event on.
 *
 * The relays not tried appear in the result all the same, marked as such:
 * leaving them out would make the configured list look shorter than it is, and
 * whoever read it would not understand why their favourite relay is nowhere to
 * be seen.
 */
async function aRotazione(
  pool: RelayPool,
  destinazioni: readonly string[],
  event: NostrEvent,
  timeout: number,
  opzioni: OpzioniPubblicazione,
): Promise<RisultatoRelay[]> {
  const risultati: RisultatoRelay[] = []

  for (const [indice, url] of destinazioni.entries()) {
    opzioni.onTentativo?.(url, indice, destinazioni.length)
    const risultato = await pubblicaSuUno(pool, url, event, timeout, opzioni.auth)
    risultati.push(risultato)
    if (preso(risultato)) break
  }

  for (const url of destinazioni.slice(risultati.length)) {
    risultati.push({
      url,
      esito: 'non tentato',
      motivo: 'Non contattato: un relay precedente aveva gia’ preso in carico l’evento.',
    })
  }

  return risultati
}

/** Publishes to a single relay, handling the authentication and the timeout. */
async function pubblicaSuUno(
  pool: RelayPool,
  url: string,
  event: NostrEvent,
  timeoutMs: number,
  auth: AuthSigner | undefined,
): Promise<RisultatoRelay> {
  const relay = pool.relay(url)

  // When the relay has already let us know that it demands authentication, it
  // is provided before trying: otherwise the publish would hang waiting and
  // would only be closed by the timeout.
  if (auth && relay.challenge !== null && !relay.authenticated) {
    try {
      await relay.authenticate(auth)
    } catch {
      // The publication's outcome will say whether it was really missing:
      // stopping here would prevent publishing to a relay that did not
      // actually require the AUTH.
    }
  }

  try {
    const risposta = await conScadenza(relay.publish(event, { timeout: timeoutMs }), timeoutMs, url)
    const { esito, motivo } = spiegaRispostaRelay(risposta.ok, risposta.message)

    // Some relays send the challenge only after seeing an EVENT: on the first
    // attempt they answer `auth-required`, and only now can we authenticate.
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

/** The second attempt, after an `auth-required`. */
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
 * Applies a deadline to a promise.
 *
 * `relay.publish` already accepts a `timeout`, but that deadline covers the
 * wait for the OK, not the wait for the authentication: without this second
 * ceiling a relay that demands NIP-42 would leave the promise unsettled.
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

/**
 * Derives a readable message from whatever the WebSocket threw.
 *
 * It is hardly ever an `Error`: rxjs propagates the DOM event directly, and an
 * `ErrorEvent` or a `CloseEvent` converted with `String()` become
 * `[object ErrorEvent]`, which tells nobody anything. The useful fields are
 * inside the object and have to be extracted by hand.
 */
function messaggioErrore(errore: unknown): string {
  if (errore instanceof Error && errore.message) return errore.message
  if (typeof errore === 'string' && errore.length > 0) return errore

  if (typeof errore === 'object' && errore !== null) {
    const e = errore as {
      type?: string
      message?: string
      reason?: string
      code?: number
      error?: unknown
    }
    if (typeof e.message === 'string' && e.message.length > 0) return e.message
    if (e.error !== undefined && e.error !== errore) return messaggioErrore(e.error)

    // CloseEvent: the code says more than the description, which is often empty.
    if (typeof e.code === 'number') {
      const motivo = typeof e.reason === 'string' && e.reason.length > 0 ? ` (${e.reason})` : ''
      return `connessione chiusa dal relay, codice ${e.code}${motivo}`
    }
    if (e.type === 'error') {
      return 'connessione rifiutata o interrotta: il relay non e’ raggiungibile da questo browser'
    }
    if (typeof e.type === 'string') return `evento WebSocket "${e.type}"`
  }

  return 'errore di connessione non identificato'
}

function descriviErrore(errore: unknown, url: string, attesaAuth: boolean): string {
  if (attesaAuth) {
    return `${url} ha chiesto l’autenticazione NIP-42 e la pubblicazione e’ rimasta in attesa. Accedi con una chiave che possa firmare.`
  }
  return messaggioErrore(errore)
}

export { messaggioErrore }

export type { PublishResponse }
