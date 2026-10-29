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

export type FileScaricato = ImmagineScaricata

/**
 * What kind of file is expected, and how to name it in the messages.
 *
 * The messages are Italian and grammatical, so the noun and the pronoun travel
 * with the type: «un'immagine… leggerla», «un file audio… leggerlo».
 */
export interface TipoAtteso {
  /** MIME prefixes or exact types accepted, e.g. `image/` or `text/vtt`. */
  tipi: readonly string[]
  /** «un'immagine», «un file audio». */
  nome: string
  /** The object pronoun: `la` for an image, `lo` for a file. */
  pronome: 'la' | 'lo'
  /** The prefix of the title the service archives it under. */
  prefissoTitolo: string
}

const IMMAGINE: TipoAtteso = {
  tipi: ['image/'],
  nome: "un'immagine",
  pronome: 'la',
  prefissoTitolo: 'immagine-da-url-',
}

/** An audio file, for the episodes of an imported podcast. */
export const TIPO_AUDIO: TipoAtteso = {
  tipi: ['audio/', 'video/mp4', 'application/octet-stream'],
  nome: 'un file audio',
  pronome: 'lo',
  prefissoTitolo: 'audio-da-url-',
}

/** A transcript or a chapters file: text that servers label in many ways. */
export const TIPO_TESTO: TipoAtteso = {
  tipi: ['text/', 'application/json', 'application/x-subrip', 'application/octet-stream'],
  nome: 'un file di testo',
  pronome: 'lo',
  prefissoTitolo: 'testo-da-url-',
}

/** The title the service archives the URL under: stable, so the second time is a 409 and gets reused. */
export async function titoloPerUrl(
  url: string,
  prefisso = IMMAGINE.prefissoTitolo,
): Promise<string> {
  return `${prefisso}${(await sha256Hex(url)).slice(0, 16)}`
}

function accettato(tipo: string, atteso: TipoAtteso): boolean {
  const base = tipo.toLowerCase().split(';')[0]?.trim() ?? ''
  return atteso.tipi.some((t) => (t.endsWith('/') ? base.startsWith(t) : base === t))
}

/**
 * Downloads a file from a URL, directly or through the service.
 *
 * The same two routes as for images, for any type: an imported podcast's
 * audio, transcripts and chapters sit on the old host, which may well not
 * expose CORS.
 */
export async function scaricaFile(
  url: string,
  atteso: TipoAtteso,
  opzioni: OpzioniScaricaImmagine = {},
): Promise<FileScaricato> {
  const eseguiFetch = opzioni.fetch ?? globalThis.fetch
  const leggi = `legger${atteso.pronome}`
  let primoErrore: string

  try {
    const risposta = await eseguiFetch(url, { mode: 'cors' })
    if (!risposta.ok) throw new Error(`il server ha risposto ${risposta.status}`)
    const blob = await risposta.blob()
    if (blob.type && !accettato(blob.type, atteso)) {
      throw new Error(`non e' ${atteso.nome} (${blob.type})`)
    }
    return { blob, via: 'diretta' }
  } catch (e) {
    primoErrore = e instanceof Error ? e.message : String(e)
  }

  if (!opzioni.mediaManager) {
    throw new Error(
      `${primoErrore}: il server non permette di ${leggi} da un'altra pagina, e non c'e' un servizio configurato che ${atteso.pronome} scarichi al posto tuo.`,
    )
  }

  try {
    const voce = await opzioni.mediaManager.caricaMediaDaUrl(
      url,
      await titoloPerUrl(url, atteso.prefissoTitolo),
    )
    const blob = await opzioni.mediaManager.scaricaContenuto(
      voce.content_url ?? `/media/${voce.id}/content`,
    )
    return { blob, via: 'servizio' }
  } catch (e) {
    const secondo = e instanceof Error ? e.message : String(e)
    throw new Error(
      `${primoErrore}: il server non permette di ${leggi} da un'altra pagina, e nemmeno il servizio e' riuscito a scaricar${atteso.pronome} (${secondo}).`,
    )
  }
}

export function scaricaImmagine(
  url: string,
  opzioni: OpzioniScaricaImmagine = {},
): Promise<ImmagineScaricata> {
  return scaricaFile(url, IMMAGINE, opzioni)
}
