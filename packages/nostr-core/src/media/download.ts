import type { ClientMediaManager } from '../mediamanager/client.js'
import { sha256Hex } from '../utils/hash.js'

/**
 * Downloads an image from a URL, to work on it in the browser.
 *
 * A «reachable» image is not necessarily readable from a page: an `<img>`
 * shows it even from a server without CORS, but `fetch` and the canvas do
 * not. Whoever wants to crop a podcast cover has almost always published it
 * somewhere already, and refusing to read it sends them off to download it by
 * hand and upload it by hand.
 *
 * So two routes, in order: the direct read, which is enough with Blossom and
 * with servers that expose CORS; otherwise the media-manager, which downloads
 * the URL from its own side (where CORS does not exist) and returns the bytes
 * with the key. Only if that fails too is the image really out of reach, and
 * then we say so.
 *
 * The messages stay in Italian: they end up in the crop dialog's alert.
 */

export interface OpzioniScaricaImmagine {
  fetch?: typeof globalThis.fetch
  /** The service, when configured: it is the second route. */
  mediaManager?: Pick<ClientMediaManager, 'caricaMediaDaUrl' | 'scaricaContenuto'> | null
}

export interface ImmagineScaricata {
  blob: Blob
  /** Where the bytes came from: to say it, not to decide anything. */
  via: 'diretta' | 'servizio'
}

/** The title the service archives the URL under: stable, so the second time is a 409 and gets reused. */
export async function titoloPerUrl(url: string): Promise<string> {
  return `immagine-da-url-${(await sha256Hex(url)).slice(0, 16)}`
}

export async function scaricaImmagine(
  url: string,
  opzioni: OpzioniScaricaImmagine = {},
): Promise<ImmagineScaricata> {
  const eseguiFetch = opzioni.fetch ?? globalThis.fetch
  let primoErrore: string

  try {
    const risposta = await eseguiFetch(url, { mode: 'cors' })
    if (!risposta.ok) throw new Error(`il server ha risposto ${risposta.status}`)
    const blob = await risposta.blob()
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error(`non e' un'immagine (${blob.type})`)
    }
    return { blob, via: 'diretta' }
  } catch (e) {
    primoErrore = e instanceof Error ? e.message : String(e)
  }

  if (!opzioni.mediaManager) {
    throw new Error(
      `${primoErrore}: il server non permette di leggerla da un'altra pagina, e non c'e' un servizio configurato che la scarichi al posto tuo.`,
    )
  }

  try {
    const voce = await opzioni.mediaManager.caricaMediaDaUrl(url, await titoloPerUrl(url))
    const blob = await opzioni.mediaManager.scaricaContenuto(
      voce.content_url ?? `/media/${voce.id}/content`,
    )
    return { blob, via: 'servizio' }
  } catch (e) {
    const secondo = e instanceof Error ? e.message : String(e)
    throw new Error(
      `${primoErrore}: il server non permette di leggerla da un'altra pagina, e nemmeno il servizio e' riuscito a scaricarla (${secondo}).`,
    )
  }
}
