import type { ElencoMedia, ImmagineGenerata, MediaItem, RichiestaImmagine } from './types.js'

/**
 * Client del microservizio media-manager.
 *
 * Il servizio elabora contenuti (compone immagini, e in prospettiva tratta
 * l'audio) e tiene un proprio archivio di media, separato da Blossom. Le due
 * cose non si sovrappongono: **Blossom conserva cio' che pubblichi**, il
 * media-manager conserva gli ingredienti e i prodotti dell'elaborazione. Il
 * ponte fra i due lo fa questo client, ed e' esplicito di proposito — un file
 * su Blossom non e' automaticamente noto al servizio, e viceversa.
 *
 * `fetch` e' iniettabile perche' il pacchetto resta isomorfico e perche' i
 * test devono poter rispondere senza rete.
 */

export interface OpzioniClientMediaManager {
  /** Radice del servizio, senza `/v0`: viene aggiunto qui. */
  baseUrl: string
  /** Chiave per l'header `X-API-Key`. Senza, il servizio risponde 401. */
  apiKey?: string
  fetch?: typeof globalThis.fetch
  /** Oltre questo tempo la richiesta si considera persa. */
  timeoutMs?: number
}

export class ErroreMediaManager extends Error {
  constructor(
    message: string,
    readonly stato: number | null,
    readonly dettaglio?: string,
  ) {
    super(message)
    this.name = 'ErroreMediaManager'
  }
}

/** Versione dell'API a cui questo client parla. */
export const VERSIONE_API = 'v0'

/** Normalizza la radice: via lo slash finale e via un `/v0` gia' scritto dall'utente. */
export function normalizzaBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/, '')
}

/**
 * Traduce un esito HTTP in un messaggio che dice cosa fare.
 *
 * Gli stati che questo servizio usa hanno significati precisi, e riportarli
 * come «errore 409» lascerebbe l'utente senza appigli.
 */
export function spiegaStato(stato: number, dettaglio?: string): string {
  const coda = dettaglio ? ` (${dettaglio})` : ''
  switch (stato) {
    case 400:
      return `Richiesta rifiutata: un parametro non va bene, oppure un asset indicato non esiste sul servizio${coda}.`
    case 401:
      return 'Chiave API mancante o non valida: impostala nelle impostazioni.'
    case 403:
      return `La chiave non e’ autorizzata a questa operazione${coda}.`
    case 404:
      return `Non trovato sul servizio${coda}.`
    case 409:
      return `Un media con lo stesso contenuto o titolo e’ gia’ presente${coda}.`
    case 413:
      return 'File troppo grande per il servizio.'
    case 501:
      return `Questa funzione e’ dichiarata nel contratto ma non ancora realizzata dal servizio${coda}.`
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

export interface ClientMediaManager {
  readonly radice: string
  /** Health check del dominio: `media` o `content`. */
  salute(dominio: 'media' | 'content'): Promise<boolean>
  elencoMedia(
    tipo: string,
    opzioni?: { title?: string; page?: number; pageSize?: number },
  ): Promise<ElencoMedia>
  caricaMedia(file: Blob, titolo: string, mediaType: string, durataS?: number): Promise<MediaItem>
  generaImmagine(richiesta: RichiestaImmagine): Promise<ImmagineGenerata>
  /**
   * Scarica i byte di un media dal servizio.
   *
   * Passa da qui e non da un `fetch` diretto perche' anche i byte sono dietro
   * la chiave: un `<img src>` verso il servizio riceverebbe un 401, e la
   * pagina mostrerebbe un'immagine rotta senza spiegazione. Per visualizzarli
   * serve scaricarli cosi' e costruire un URL locale.
   */
  scaricaContenuto(percorsoRelativo: string): Promise<Blob>
  /** URL assoluto dei byte di un media, a partire da un percorso relativo del servizio. */
  urlAssoluto(percorsoRelativo: string): string
}

export function creaClientMediaManager(opzioni: OpzioniClientMediaManager): ClientMediaManager {
  const radice = normalizzaBaseUrl(opzioni.baseUrl)
  if (radice === '') throw new Error('Indirizzo del servizio media-manager mancante.')

  const eseguiFetch = opzioni.fetch ?? globalThis.fetch
  const timeout = opzioni.timeoutMs ?? 120_000

  const intestazioni = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(opzioni.apiKey ? { 'X-API-Key': opzioni.apiKey } : {}),
    ...extra,
  })

  async function chiama(percorso: string, init: RequestInit = {}): Promise<Response> {
    const controllo = new AbortController()
    const orologio = setTimeout(() => controllo.abort(), timeout)
    try {
      return await eseguiFetch(`${radice}/${VERSIONE_API}${percorso}`, {
        ...init,
        signal: controllo.signal,
      })
    } catch (e) {
      // Dal browser, una richiesta bloccata da CORS o da contenuto misto
      // fallisce **prima** di ricevere una risposta, e l'errore non dice
      // perche'. Va spiegato qui, o l'utente cerca il guasto dalla parte
      // sbagliata: la sua rete sembra a posto e il servizio risponde a mano.
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ErroreMediaManager(
          `Il servizio non ha risposto entro ${Math.round(timeout / 1000)}s.`,
          null,
        )
      }
      throw new ErroreMediaManager(
        'Non e’ stato possibile raggiungere il servizio. Dal browser le cause piu’ frequenti ' +
          'non sono la rete: il servizio non espone le intestazioni CORS, oppure questa pagina ' +
          'e’ su https e il servizio su http (contenuto misto, che il browser blocca).',
        null,
        e instanceof Error ? e.message : String(e),
      )
    } finally {
      clearTimeout(orologio)
    }
  }

  async function esito<T>(risposta: Response): Promise<T> {
    if (risposta.ok) return (await risposta.json()) as T

    let dettaglio: string | undefined
    try {
      const corpo = (await risposta.json()) as { detail?: string; message?: string; title?: string }
      dettaglio = corpo.detail ?? corpo.message ?? corpo.title
    } catch {
      // Corpo non JSON (una pagina d'errore di nginx, per dire): resta lo stato.
    }
    throw new ErroreMediaManager(
      spiegaStato(risposta.status, dettaglio),
      risposta.status,
      dettaglio,
    )
  }

  return {
    radice,

    async salute(dominio) {
      try {
        const r = await chiama(`/${dominio}/health`)
        return r.ok
      } catch {
        return false
      }
    },

    async elencoMedia(tipo, o = {}) {
      const q = new URLSearchParams({ type: tipo })
      if (o.title) q.set('title', o.title)
      if (o.page) q.set('page', String(o.page))
      if (o.pageSize) q.set('page_size', String(o.pageSize))
      return esito<ElencoMedia>(await chiama(`/media?${q}`, { headers: intestazioni() }))
    },

    async caricaMedia(file, titolo, mediaType, durataS) {
      const modulo = new FormData()
      modulo.append('file', file, titolo)
      modulo.append('title', titolo)
      modulo.append('media_type', mediaType)
      if (durataS !== undefined) modulo.append('duration_s', String(durataS))

      // Nessun content-type a mano: il confine multipart lo scrive fetch.
      return esito<MediaItem>(
        await chiama('/media', { method: 'POST', headers: intestazioni(), body: modulo }),
      )
    },

    async generaImmagine(richiesta) {
      return esito<ImmagineGenerata>(
        await chiama('/content/image', {
          method: 'POST',
          headers: intestazioni({ 'content-type': 'application/json' }),
          body: JSON.stringify(richiesta),
        }),
      )
    },

    async scaricaContenuto(percorsoRelativo) {
      const percorso = percorsoRelativo.replace(/^\/?v0/, '')
      const risposta = await chiama(percorso.startsWith('/') ? percorso : `/${percorso}`, {
        headers: intestazioni(),
      })
      if (!risposta.ok) {
        let dettaglio: string | undefined
        try {
          dettaglio = ((await risposta.json()) as { detail?: string }).detail
        } catch {
          // Corpo non JSON: resta lo stato.
        }
        throw new ErroreMediaManager(spiegaStato(risposta.status, dettaglio), risposta.status)
      }
      return risposta.blob()
    },

    urlAssoluto(percorsoRelativo) {
      if (/^https?:\/\//i.test(percorsoRelativo)) return percorsoRelativo
      const p = percorsoRelativo.startsWith('/') ? percorsoRelativo : `/${percorsoRelativo}`
      return `${radice}${p}`
    },
  }
}
