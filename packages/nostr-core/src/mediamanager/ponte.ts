import type { ClientMediaManager } from './client.js'
import { ErroreMediaManager } from './client.js'
import type { ImmagineGenerata, MediaItem } from './types.js'

/**
 * Ponte fra Blossom e il media-manager.
 *
 * I due archivi non si conoscono: un file su Blossom e' raggiungibile dal suo
 * indirizzo, ma il servizio di elaborazione lavora solo su cio' che ha nel
 * proprio archivio, e vi si riferisce per id o per nome. Perche' un'immagine
 * gia' pubblicata diventi un ingrediente, i suoi byte devono passare di la'.
 *
 * Oggi il passaggio avviene **attraverso il browser**: si scaricano i byte da
 * Blossom e si ricaricano sul servizio. Funziona, ma paga due volte la banda
 * e il tempo. Il contratto del servizio prevede gia' un
 * `POST /source/media/from-url`, che scaricherebbe da se': e' pero' dichiarato
 * «uso interno» e non e' esposto pubblicamente, quindi non e' utilizzabile da
 * qui. Vedi il prompt per l'agente delle API.
 */

/** Estensione plausibile per un tipo MIME, usata a comporre il titolo. */
function estensioneDi(mime: string): string {
  const noto: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'video/mp4': 'mp4',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
  }
  return noto[mime.toLowerCase()] ?? 'bin'
}

/**
 * Tipi che il servizio accetta oggi in `media_type`.
 *
 * L'elenco e' chiuso nel contratto, e non copre tutto quello che serve: manca
 * `audio/wav`, manca `font/ttf` — benche' il generatore di immagini accetti un
 * font «caricato su source» — e `audio/mp3` non e' un tipo MIME reale, quello
 * giusto e' `audio/mpeg`. Finche' resta cosi', un font o un wav non si possono
 * caricare passando dal dominio pubblico.
 */
export const TIPI_ACCETTATI = [
  'audio/m4a',
  'audio/mp3',
  'video/mp4',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

/** Il tipo dichiarabile al servizio per un file, o `null` se non lo accetta. */
export function tipoAccettato(mime: string): string | null {
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  if ((TIPI_ACCETTATI as readonly string[]).includes(m)) return m
  // Due equivalenze che il contratto non nomina ma che sono la stessa cosa.
  if (m === 'audio/mpeg') return 'audio/mp3'
  if (m === 'audio/mp4' || m === 'audio/x-m4a') return 'audio/m4a'
  if (m === 'image/jpg') return 'image/jpeg'
  return null
}

export interface EsitoPonte {
  media: MediaItem
  /** Vero se il file era gia' presente sul servizio: non e' un errore. */
  giaPresente: boolean
}

/**
 * Porta sul servizio un file preso da un indirizzo (tipicamente Blossom).
 *
 * Un 409 non viene trattato come errore: significa che quel contenuto c'era
 * gia', ed e' l'esito normale quando si rielabora lo stesso asset due volte.
 */
export async function portaSulServizio(
  client: ClientMediaManager,
  origine: { blob: Blob; titolo: string; mime?: string },
): Promise<EsitoPonte> {
  const mime = origine.mime ?? origine.blob.type
  const tipo = tipoAccettato(mime)
  if (!tipo) {
    throw new Error(
      `Il servizio non accetta file di tipo ${mime || 'sconosciuto'}: ` +
        `accetta ${TIPI_ACCETTATI.join(', ')}.`,
    )
  }

  const titolo = origine.titolo.includes('.')
    ? origine.titolo
    : `${origine.titolo}.${estensioneDi(mime)}`

  try {
    return { media: await client.caricaMedia(origine.blob, titolo, tipo), giaPresente: false }
  } catch (e) {
    if (e instanceof ErroreMediaManager && e.stato === 409) {
      const elenco = await client.elencoMedia(tipo, { title: origine.titolo, pageSize: 5 })
      const trovato = elenco.items[0]
      if (trovato) return { media: trovato, giaPresente: true }
    }
    throw e
  }
}

/**
 * Scarica i byte di un'immagine generata, per salvarli o rimandarli su Blossom.
 *
 * Passa dal client e non da un `fetch` diretto: anche i byte sono protetti
 * dalla chiave, e una richiesta senza intestazione riceve 401. E' anche il
 * motivo per cui l'anteprima in pagina non puo' essere un semplice `<img src>`
 * verso il servizio.
 */
export async function scaricaGenerata(
  client: ClientMediaManager,
  immagine: ImmagineGenerata,
): Promise<Blob> {
  return client.scaricaContenuto(immagine.download_url)
}
