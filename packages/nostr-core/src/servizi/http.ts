/**
 * Dialogo HTTP con i servizi esterni di elaborazione.
 *
 * Sta a parte perche' i servizi sono due — il media-manager per le immagini,
 * il servizio ffmpeg per l'audio — e sbagliano nello stesso modo. Soprattutto
 * falliscono nello stesso modo **dal browser**, dove un errore di rete non dice
 * mai perche', e la causa vera quasi mai e' la rete.
 */

export class ErroreServizio extends Error {
  constructor(
    message: string,
    readonly stato: number | null,
    readonly dettaglio?: string,
  ) {
    super(message)
    this.name = 'ErroreServizio'
  }
}

/** Via lo slash finale e un eventuale `/v0` gia' scritto dall'utente. */
export function normalizzaBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/, '')
}

/**
 * Traduce un esito HTTP in un messaggio che dice cosa fare.
 *
 * Riportare «errore 409» lascerebbe l'utente senza appigli: gli stati che
 * questi servizi usano hanno significati precisi e rimediabili.
 */
export function spiegaStato(stato: number, dettaglio?: string): string {
  const coda = dettaglio ? ` (${dettaglio})` : ''
  switch (stato) {
    case 400:
      return `Richiesta rifiutata: un parametro non va bene, oppure un file indicato non esiste sul servizio${coda}.`
    case 401:
      return 'Chiave API mancante o non valida: impostala nelle impostazioni.'
    case 403:
      return `Il servizio non autorizza questa operazione${coda}.`
    case 404:
      return `Non trovato sul servizio${coda}.`
    case 405:
      return `Il servizio non accetta questo metodo su questo indirizzo${coda}.`
    case 409:
      return `Un file con lo stesso contenuto o nome e’ gia’ presente${coda}.`
    case 413:
      return 'File troppo grande per il servizio.'
    case 501:
      return `Questa funzione e’ dichiarata ma non ancora realizzata dal servizio${coda}.`
    case 502:
    case 503:
    case 504:
      return 'Il servizio non risponde: potrebbe essere spento o in aggiornamento.'
    default:
      return stato >= 500
        ? `Errore interno del servizio (${stato})${coda}.`
        : `Risposta ${stato}${coda}.`
  }
}

/**
 * Perche' una richiesta puo' fallire *prima* di partire, nel browser.
 *
 * Le due cause piu' frequenti non sono la rete, e non si distinguono
 * dall'errore nativo: il servizio non espone le intestazioni CORS, oppure la
 * pagina e' su https e il servizio su http. In entrambi i casi il servizio
 * risponde benissimo da riga di comando, e chi cerca il guasto lo cerca dove
 * non e'.
 */
export const CAUSE_PROBABILI_RETE =
  'Non e’ stato possibile raggiungere il servizio. Dal browser le cause piu’ frequenti non sono ' +
  'la rete: il servizio potrebbe non esporre le intestazioni CORS, oppure questa pagina e’ su ' +
  'https e il servizio su http (contenuto misto, che il browser blocca).'

export interface OpzioniChiamata {
  fetch?: typeof globalThis.fetch
  /** Oltre questo tempo la richiesta si considera persa. */
  timeoutMs?: number
}

/** `fetch` con scadenza e con gli errori di rete tradotti in qualcosa di azionabile. */
export async function chiama(
  url: string,
  init: RequestInit,
  opzioni: OpzioniChiamata = {},
): Promise<Response> {
  const eseguiFetch = opzioni.fetch ?? globalThis.fetch
  const timeout = opzioni.timeoutMs ?? 120_000

  const controllo = new AbortController()
  const orologio = setTimeout(() => controllo.abort(), timeout)
  try {
    return await eseguiFetch(url, { ...init, signal: controllo.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ErroreServizio(
        `Il servizio non ha risposto entro ${Math.round(timeout / 1000)}s.`,
        null,
      )
    }
    throw new ErroreServizio(CAUSE_PROBABILI_RETE, null, e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(orologio)
  }
}

/** Il corpo JSON, oppure un errore gia' tradotto. */
export async function esito<T>(risposta: Response): Promise<T> {
  if (risposta.ok) return (await risposta.json()) as T

  let dettaglio: string | undefined
  try {
    const corpo = (await risposta.json()) as {
      detail?: string
      message?: string
      title?: string
      error?: string
    }
    dettaglio = corpo.detail ?? corpo.message ?? corpo.error ?? corpo.title
  } catch {
    // Corpo non JSON — una pagina d'errore di nginx, per dire: resta lo stato.
  }
  throw new ErroreServizio(spiegaStato(risposta.status, dettaglio), risposta.status, dettaglio)
}
