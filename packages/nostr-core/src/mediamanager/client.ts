import {
  chiama as chiamaHttp,
  esito as esitoHttp,
  ErroreServizio,
  normalizzaBaseUrl,
} from '../servizi/http.js'
import type { ElencoMedia, MediaItem } from './types.js'

/**
 * Client del microservizio media-manager.
 *
 * Il servizio elabora contenuti e tiene un proprio archivio di media,
 * separato da Blossom. Le due cose non si sovrappongono: **Blossom conserva
 * cio' che pubblichi**, il media-manager conserva le sorgenti e i prodotti
 * dell'elaborazione. Un file su Blossom non e' automaticamente noto al
 * servizio, e viceversa.
 *
 * Qui c'e' il dominio `media` (l'archivio); il dominio `audio` ha un client
 * suo in `src/audio/`, sullo stesso indirizzo e con la stessa chiave.
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

/**
 * Errore del media-manager.
 *
 * Specializza quello condiviso invece di sostituirlo: chi filtra per
 * `ErroreServizio` prende anche questi, chi vuole distinguere il servizio ha
 * ancora un tipo suo.
 */
export class ErroreMediaManager extends ErroreServizio {
  constructor(message: string, stato: number | null, dettaglio?: string) {
    super(message, stato, dettaglio)
    this.name = 'ErroreMediaManager'
  }
}

/** Versione dell'API a cui questo client parla. */
export const VERSIONE_API = 'v0'

export interface ClientMediaManager {
  readonly radice: string
  /** Health check di un dominio pubblico. */
  salute(dominio: 'media' | 'content' | 'audio'): Promise<boolean>
  /** Senza `tipo` elenca tutto l'archivio: il filtro e' opzionale. */
  elencoMedia(
    tipo?: string,
    opzioni?: { title?: string; page?: number; pageSize?: number },
  ): Promise<ElencoMedia>
  caricaMedia(file: Blob, titolo: string, mediaType: string, durataS?: number): Promise<MediaItem>
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

  const rete = {
    ...(opzioni.fetch ? { fetch: opzioni.fetch } : {}),
    ...(opzioni.timeoutMs !== undefined ? { timeoutMs: opzioni.timeoutMs } : {}),
  }

  const intestazioni = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(opzioni.apiKey ? { 'X-API-Key': opzioni.apiKey } : {}),
    ...extra,
  })

  // La traduzione degli errori — stati HTTP, scadenza, e il fallimento di rete
  // che nel browser quasi sempre e' CORS o contenuto misto — vive in
  // `servizi/http.ts`, condivisa con il client audio. Qui si aggiunge solo il
  // prefisso di versione e si rietichetta l'errore col nome del servizio.
  const chiama = (percorso: string, init: RequestInit = {}): Promise<Response> =>
    chiamaHttp(`${radice}/${VERSIONE_API}${percorso}`, init, rete).catch(rietichetta)

  const esito = <T>(risposta: Response): Promise<T> => esitoHttp<T>(risposta).catch(rietichetta)

  function rietichetta(e: unknown): never {
    if (e instanceof ErroreServizio && !(e instanceof ErroreMediaManager)) {
      throw new ErroreMediaManager(e.message, e.stato, e.dettaglio)
    }
    throw e
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
      const q = new URLSearchParams()
      if (tipo) q.set('type', tipo)
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

    async scaricaContenuto(percorsoRelativo) {
      const percorso = percorsoRelativo.replace(/^\/?v0/, '')
      const risposta = await chiama(percorso.startsWith('/') ? percorso : `/${percorso}`, {
        headers: intestazioni(),
      })
      // `esito` qui non va: la risposta buona sono byte, non JSON. Si riusa
      // solo per la traduzione dell'errore, che alla risposta buona non arriva.
      if (!risposta.ok) await esito<never>(risposta)
      return risposta.blob()
    },

    urlAssoluto(percorsoRelativo) {
      if (/^https?:\/\//i.test(percorsoRelativo)) return percorsoRelativo
      const p = percorsoRelativo.startsWith('/') ? percorsoRelativo : `/${percorsoRelativo}`
      return `${radice}${p}`
    },
  }
}
