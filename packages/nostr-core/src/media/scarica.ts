import type { ClientMediaManager } from '../mediamanager/client.js'
import { sha256Hex } from '../utils/hash.js'

/**
 * Scarica un'immagine da un URL, per lavorarla nel browser.
 *
 * Un'immagine «raggiungibile» non e' per forza leggibile da una pagina: un
 * `<img>` la mostra anche da un server senza CORS, ma `fetch` e la tela no.
 * Chi vuole ritagliare la copertina di un podcast la ha quasi sempre gia'
 * pubblicata da qualche parte, e rifiutarsi di leggerla lo manda a scaricarla
 * a mano per ricaricarla a mano.
 *
 * Quindi due strade, nell'ordine: la lettura diretta, che basta con Blossom e
 * con i server che espongono CORS; altrimenti il media-manager, che scarica
 * l'URL dal proprio lato (dove il CORS non esiste) e restituisce i byte con
 * la chiave. Solo se fallisce anche quella l'immagine e' davvero fuori
 * portata, e lo si dice.
 */

export interface OpzioniScaricaImmagine {
  fetch?: typeof globalThis.fetch
  /** Il servizio, se configurato: e' la seconda strada. */
  mediaManager?: Pick<ClientMediaManager, 'caricaMediaDaUrl' | 'scaricaContenuto'> | null
}

export interface ImmagineScaricata {
  blob: Blob
  /** Da dove sono arrivati i byte: serve a dirlo, non a decidere. */
  via: 'diretta' | 'servizio'
}

/** Il titolo con cui il servizio archivia l'URL: stabile, cosi' la seconda volta e' un 409 e si riusa. */
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
