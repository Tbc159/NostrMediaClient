import { z } from 'zod'

import type { Tag } from './tags.js'
import type { NostrEvent } from './types.js'

/**
 * Tag `imeta` — metadati di un allegato (NIP-92).
 *
 * E' un tag *variadico*: dopo il nome vengono coppie `chiave valore` separate
 * da uno spazio, tutte dentro un unico elemento dell'array. Cioe':
 *
 *   ['imeta', 'url https://…/foto.jpg', 'm image/jpeg', 'dim 800x600']
 *
 * e non un tag per campo. E' la forma piu' sbagliata di tutto NIP-92, perche'
 * il formato ricorda quello dei tag normali ma non lo e': scriverlo come
 * `['imeta', 'url', 'https://…']` produce un tag che nessun altro client
 * riesce a leggere.
 *
 * I campi disponibili sono quelli di NIP-94. `url` e' obbligatorio e la
 * specifica chiede almeno un altro campo: un `imeta` con la sola url non
 * aggiunge nulla a quello che gia' si legge nel content.
 */

export const imetaSchema = z.object({
  /** URL da cui scaricare il file. Obbligatorio. */
  url: z.string(),
  /** Tipo MIME, minuscolo (`m` in NIP-94). */
  mime: z.string().optional(),
  /** SHA-256 esadecimale del file servito. */
  sha256: z.string().optional(),
  /** SHA-256 del file **originale**, prima delle trasformazioni del server. */
  sha256Originale: z.string().optional(),
  /** Dimensione in byte. */
  size: z.number().int().nonnegative().optional(),
  /** Dimensioni in pixel, `larghezzaxaltezza`. */
  dim: z.string().optional(),
  /** Blurhash da mostrare durante il caricamento. */
  blurhash: z.string().optional(),
  /** Descrizione per chi non vede l'immagine. */
  alt: z.string().optional(),
  /** Miniatura con lo stesso rapporto d'aspetto. */
  thumb: z.string().optional(),
  /** Immagini di anteprima, alla stessa risoluzione (NIP-71). */
  image: z.array(z.string()),
  /** Durata in secondi, per audio e video (NIP-71). */
  duration: z.number().optional(),
  /** Bitrate medio in bit/s (NIP-71). */
  bitrate: z.number().int().optional(),
  /** Copie alternative, se `url` non risponde. */
  fallback: z.array(z.string()),
})

export type Imeta = z.infer<typeof imetaSchema>

export interface ImetaInput {
  url: string
  mime?: string
  sha256?: string
  sha256Originale?: string
  size?: number
  dim?: string
  blurhash?: string
  alt?: string
  thumb?: string
  image?: string[]
  duration?: number
  bitrate?: number
  fallback?: string[]
}

/** Larghezza e altezza in pixel, nel formato `<w>x<h>` voluto da NIP-94. */
export function dimensioni(larghezza: number, altezza: number): string {
  return `${Math.round(larghezza)}x${Math.round(altezza)}`
}

/** Costruisce il tag `imeta` a partire dai metadati di un allegato. */
export function buildImetaTag(input: ImetaInput): Tag {
  if (!input.url) throw new Error('Un tag imeta senza url non e’ valido (NIP-92).')

  const campi: string[] = [`url ${input.url}`]
  const aggiungi = (chiave: string, valore: string | number | undefined): void => {
    if (valore === undefined || valore === '') return
    campi.push(`${chiave} ${valore}`)
  }

  aggiungi('m', input.mime)
  aggiungi('x', input.sha256)
  aggiungi('ox', input.sha256Originale)
  aggiungi('size', input.size)
  aggiungi('dim', input.dim)
  aggiungi('blurhash', input.blurhash)
  aggiungi('thumb', input.thumb)
  for (const i of input.image ?? []) aggiungi('image', i)
  aggiungi('duration', input.duration)
  aggiungi('bitrate', input.bitrate)
  // `alt` puo' contenere spazi: e' l'ultimo campo posizionale problematico,
  // ma la specifica lo ammette e i lettori spezzano solo sul primo spazio.
  aggiungi('alt', input.alt)
  for (const f of input.fallback ?? []) aggiungi('fallback', f)

  if (campi.length === 1) {
    throw new Error(
      'NIP-92 chiede almeno un campo oltre a url: un imeta con la sola url non aggiunge nulla.',
    )
  }

  return ['imeta', ...campi]
}

/**
 * Interpreta un tag `imeta`.
 *
 * Ogni voce si spezza sul **primo** spazio soltanto: i valori possono
 * contenerne (l'`alt` quasi sempre), e usare `split(' ')` troncherebbe la
 * descrizione alla prima parola.
 */
export function parseImetaTag(tag: readonly string[]): Imeta | null {
  const campi = new Map<string, string[]>()

  for (const voce of tag.slice(1)) {
    const spazio = voce.indexOf(' ')
    if (spazio <= 0) continue
    const chiave = voce.slice(0, spazio)
    const valore = voce.slice(spazio + 1).trim()
    if (valore.length === 0) continue
    campi.set(chiave, [...(campi.get(chiave) ?? []), valore])
  }

  const url = campi.get('url')?.[0]
  if (url === undefined) return null

  const primo = (k: string): string | undefined => campi.get(k)?.[0]
  const numero = (k: string): number | undefined => {
    const v = primo(k)
    if (v === undefined) return undefined
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }

  const decimale = (k: string): number | undefined => {
    const v = primo(k)
    if (v === undefined) return undefined
    const n = Number.parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }

  const risultato: Imeta = {
    url,
    image: campi.get('image') ?? [],
    fallback: campi.get('fallback') ?? [],
  }
  const opzionali: [keyof Imeta, string | number | undefined][] = [
    ['mime', primo('m')],
    ['sha256', primo('x')],
    ['sha256Originale', primo('ox')],
    ['size', numero('size')],
    ['dim', primo('dim')],
    ['blurhash', primo('blurhash')],
    ['alt', primo('alt')],
    ['thumb', primo('thumb')],
    ['duration', decimale('duration')],
    ['bitrate', numero('bitrate')],
  ]
  for (const [chiave, valore] of opzionali) {
    if (valore !== undefined) Object.assign(risultato, { [chiave]: valore })
  }

  return imetaSchema.parse(risultato)
}

/** Tutti gli allegati dichiarati da un evento. */
export function imetaOf(event: NostrEvent): Imeta[] {
  return event.tags
    .filter((t) => t[0] === 'imeta')
    .map(parseImetaTag)
    .filter((x): x is Imeta => x !== null)
}
