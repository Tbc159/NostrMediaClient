/**
 * The HTTP conversation with the external processing services.
 *
 * It lives apart because there are two services — the media-manager for
 * images, the ffmpeg service for audio — and they go wrong in the same way.
 * Above all they fail in the same way **from the browser**, where a network
 * error never says why, and the real cause is hardly ever the network.
 *
 * The messages below stay in Italian: they are shown to whoever uses the
 * client, and the interface is Italian. They will be translated with it.
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

/** Drops the trailing slash and any `/v0` the user has already written. */
export function normalizzaBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/, '')
}

/**
 * Turns an HTTP outcome into a message that says what to do.
 *
 * Reporting «error 409» would leave the user with nothing to hold on to: the
 * statuses these services use have precise, remediable meanings.
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
      return `Un file con lo stesso contenuto o nome è già presente${coda}.`
    case 413:
      return 'File troppo grande per il servizio.'
    case 501:
      return `Questa funzione è dichiarata ma non ancora realizzata dal servizio${coda}.`
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
 * Why a request can fail *before* it leaves, in the browser.
 *
 * The two most frequent causes are not the network, and the native error does
 * not tell them apart: the service does not expose the CORS headers, or the
 * page is on https and the service on http. In both cases the service answers
 * perfectly well from the command line, and whoever looks for the fault looks
 * where it is not.
 */
export const CAUSE_PROBABILI_RETE =
  'Non è stato possibile raggiungere il servizio. Dal browser le cause più frequenti non sono ' +
  'la rete: il servizio potrebbe non esporre le intestazioni CORS, oppure questa pagina è su ' +
  'https e il servizio su http (contenuto misto, che il browser blocca).'

export interface OpzioniChiamata {
  fetch?: typeof globalThis.fetch
  /** Past this much time the request is considered lost. */
  timeoutMs?: number
}

/** `fetch` with a deadline, and network errors turned into something actionable. */
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

/** The JSON body, or an already-translated error. */
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
    // A non-JSON body — an nginx error page, say: the status is all we keep.
  }
  throw new ErroreServizio(spiegaStato(risposta.status, dettaglio), risposta.status, dettaglio)
}
