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
 * Per un file gia' pubblicato il passaggio lo fa **il servizio**, con
 * `POST /v0/media/from-url`: i byte non transitano dal browser, che prima li
 * scaricava e li rimandava indietro pagando due volte banda e tempo. Dal
 * browser restano solo i file che stanno sul disco di chi guarda, che nessun
 * server puo' andare a prendere da se'.
 */

/** Estensione plausibile per un tipo MIME, usata a comporre il titolo. */
function estensioneDi(mime: string): string {
  const noto: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'video/mp4': 'mp4',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
  }
  return noto[mime.toLowerCase()] ?? 'bin'
}

/**
 * Tipi che il servizio accetta in `media_type`.
 *
 * `audio/mp3` resta accettato dal contratto come alias legacy, ma qui si manda
 * sempre `audio/mpeg`, che e' il tipo registrato. I font sono elencabili ma
 * non caricabili dal dominio pubblico: si caricano solo dalla rete interna.
 */
export const TIPI_ACCETTATI = [
  'audio/m4a',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

/** Il tipo dichiarabile al servizio per un file, o `null` se non lo accetta. */
export function tipoAccettato(mime: string): string | null {
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  if ((TIPI_ACCETTATI as readonly string[]).includes(m)) return m
  // Nomi diversi per la stessa cosa, che il contratto non elenca.
  if (m === 'audio/mp3') return 'audio/mpeg'
  if (m === 'audio/mp4' || m === 'audio/x-m4a') return 'audio/m4a'
  if (m === 'audio/x-wav' || m === 'audio/wave') return 'audio/wav'
  if (m === 'image/jpg') return 'image/jpeg'
  return null
}

export interface EsitoPonte {
  media: MediaItem
  /** Vero se il file era gia' presente sul servizio: non e' un errore. */
  giaPresente: boolean
}

/**
 * Porta sul servizio i byte di un file locale.
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
  if (!tipo) throw new Error(rifiuto(mime))

  return riusaSeGiaPresente(client, origine.titolo, tipo, () =>
    client.caricaMedia(origine.blob, titoloConEstensione(origine.titolo, mime), tipo),
  )
}

/**
 * Porta sul servizio un file che sta a un indirizzo pubblico.
 *
 * Lo scarica **il servizio**, non il browser: per un episodio da decine di
 * megabyte la differenza non e' teorica. Il tipo si puo' omettere — lo ricava
 * dal `Content-Type` della risposta — ma quando lo si conosce conviene dirlo,
 * perche' molti archivi servono tutto come `application/octet-stream`.
 */
export async function portaDaIndirizzo(
  client: ClientMediaManager,
  origine: { url: string; titolo: string; mime?: string },
): Promise<EsitoPonte> {
  const tipo = origine.mime ? tipoAccettato(origine.mime) : null
  if (origine.mime && !tipo) throw new Error(rifiuto(origine.mime))

  return riusaSeGiaPresente(client, origine.titolo, tipo, () =>
    client.caricaMediaDaUrl(origine.url, origine.titolo, tipo ?? undefined),
  )
}

function rifiuto(mime: string): string {
  return (
    `Il servizio non accetta file di tipo ${mime || 'sconosciuto'}: ` +
    `accetta ${TIPI_ACCETTATI.join(', ')}.`
  )
}

/** Il titolo con un'estensione plausibile, se non ne ha gia' una. */
function titoloConEstensione(titolo: string, mime: string): string {
  return titolo.includes('.') ? titolo : `${titolo}.${estensioneDi(mime)}`
}

/**
 * Esegue il caricamento e, se il servizio risponde «c'e' gia'», recupera il
 * record esistente invece di far fallire l'operazione.
 *
 * Il 409 non porta con se' l'id, quindi il record va ritrovato per titolo:
 * e' l'unico appiglio che il chiamante conosce prima di aver visto la
 * risposta.
 */
async function riusaSeGiaPresente(
  client: ClientMediaManager,
  titolo: string,
  tipo: string | null,
  carica: () => Promise<MediaItem>,
): Promise<EsitoPonte> {
  try {
    return { media: await carica(), giaPresente: false }
  } catch (e) {
    if (e instanceof ErroreMediaManager && e.stato === 409) {
      const elenco = await client.elencoMedia(tipo ?? undefined, { title: titolo, pageSize: 5 })
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
 * dalla chiave, e una richiesta senza intestazione riceve 401. Per la sola
 * anteprima esiste ora `signed_url`, che un `<img src>` puo' usare da solo:
 * vedi `urlPerAnteprima`.
 */
export async function scaricaGenerata(
  client: ClientMediaManager,
  immagine: ImmagineGenerata,
): Promise<Blob> {
  return client.scaricaContenuto(immagine.download_url)
}

/**
 * L'URL da mettere in un `<img src>` o `<audio src>`, se il servizio lo offre.
 *
 * `signed_url` e' relativo alla radice del servizio e porta un token a
 * scadenza: e' l'unico che il browser puo' chiedere da solo, perche' alle
 * sotto-risorse non allega intestazioni. Se manca — l'ambiente puo' non avere
 * una chiave di firma — restituisce `null`, e chi chiama ricade sui byte
 * scaricati con la chiave.
 */
export function urlPerAnteprima(
  client: ClientMediaManager,
  media: { signed_url?: string },
): string | null {
  return media.signed_url ? client.urlAssoluto(media.signed_url) : null
}
