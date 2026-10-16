import {
  chiama as chiamaHttp,
  esito as esitoHttp,
  ErroreServizio,
  normalizzaBaseUrl,
} from '../services/http.js'
import type { ElencoMedia, MediaItem } from './types.js'

/**
 * The client for the media-manager microservice.
 *
 * The service processes content and keeps an archive of media of its own,
 * separate from Blossom. The two do not overlap: **Blossom keeps what you
 * publish**, the media-manager keeps the sources and the products of
 * processing. A file on Blossom is not automatically known to the service,
 * and the other way round.
 *
 * Here is the `media` domain (the archive); the `audio` domain has a client
 * of its own in `src/audio/`, on the same address and with the same key.
 *
 * `fetch` is injectable because the package stays isomorphic and because the
 * tests have to be able to answer without a network.
 */

export interface OpzioniClientMediaManager {
  /** The service's root, without `/v0`: that is added here. */
  baseUrl: string
  /** The key for the `X-API-Key` header. Without it the service answers 401. */
  apiKey?: string
  fetch?: typeof globalThis.fetch
  /** Past this much time the request is considered lost. */
  timeoutMs?: number
}

/**
 * A media-manager error.
 *
 * It specialises the shared one instead of replacing it: whoever filters on
 * `ErroreServizio` catches these too, and whoever wants to tell this service
 * apart still has a type of its own.
 */
export class ErroreMediaManager extends ErroreServizio {
  constructor(message: string, stato: number | null, dettaglio?: string) {
    super(message, stato, dettaglio)
    this.name = 'ErroreMediaManager'
  }
}

/** The version of the API this client speaks. */
export const VERSIONE_API = 'v0'

export interface ClientMediaManager {
  readonly radice: string
  /** The health check of a public domain. */
  salute(dominio: 'media' | 'content' | 'audio'): Promise<boolean>
  /** Without `tipo` it lists the whole archive: the filter is optional. */
  elencoMedia(
    tipo?: string,
    opzioni?: { title?: string; page?: number; pageSize?: number },
  ): Promise<ElencoMedia>
  caricaMedia(file: Blob, titolo: string, mediaType: string, durataS?: number): Promise<MediaItem>
  /**
   * Has the service download a URL and put it in the archive (`POST /media/from-url`).
   *
   * It is the way to read a file the browser cannot read: an image on a server
   * without CORS shows in an `<img>` but cannot be touched from a script. The
   * service does not have this limit. A 409 is «I have it already»: the record
   * is found again by title and returned, as the audio client does.
   */
  caricaMediaDaUrl(url: string, titolo: string, mediaType?: string): Promise<MediaItem>
  /**
   * Downloads a medium's bytes from the service.
   *
   * This is the way through rather than a direct `fetch`, because the bytes
   * too sit behind the key: an `<img src>` pointing at the service would get a
   * 401, and the page would show a broken image with no explanation. To
   * display them you have to download them like this and build a local URL.
   */
  scaricaContenuto(percorsoRelativo: string): Promise<Blob>
  /** A medium's bytes' absolute URL, starting from a relative path of the service's. */
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

  // The translation of errors — HTTP statuses, the timeout, and the network
  // failure that in the browser is nearly always CORS or mixed content — lives
  // in `services/http.ts`, shared with the audio client. Here only the version
  // prefix is added, and the error is relabelled with the service's name.
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

      // No content-type by hand: fetch writes the multipart boundary.
      return esito<MediaItem>(
        await chiama('/media', { method: 'POST', headers: intestazioni(), body: modulo }),
      )
    },

    async caricaMediaDaUrl(url, titolo, mediaType) {
      const risposta = await chiama('/media/from-url', {
        method: 'POST',
        headers: intestazioni({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          url,
          title: titolo,
          ...(mediaType ? { media_type: mediaType } : {}),
        }),
      })
      if (risposta.status === 409) {
        const q = new URLSearchParams({ title: titolo })
        const elenco = await esito<ElencoMedia>(
          await chiama(`/media?${q}`, { headers: intestazioni() }),
        )
        const esistente = elenco.items.find((m) => m.title === titolo)
        if (esistente) return esistente
      }
      return esito<MediaItem>(risposta)
    },

    async scaricaContenuto(percorsoRelativo) {
      const percorso = percorsoRelativo.replace(/^\/?v0/, '')
      const risposta = await chiama(percorso.startsWith('/') ? percorso : `/${percorso}`, {
        headers: intestazioni(),
      })
      // `esito` will not do here: the good answer is bytes, not JSON. It is
      // reused only for translating the error, which a good answer never hits.
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
