import { z } from 'zod'

import type { Tag } from './tags.js'
import type { NostrEvent } from './types.js'

/**
 * The `imeta` tag — an attachment's metadata (NIP-92).
 *
 * It is a *variadic* tag: after the name come `key value` pairs separated by
 * a space, all inside a single element of the array. That is:
 *
 *   ['imeta', 'url https://…/photo.jpg', 'm image/jpeg', 'dim 800x600']
 *
 * and not one tag per field. It is the easiest thing in all of NIP-92 to get
 * wrong, because the format resembles that of ordinary tags and is not:
 * writing it as `['imeta', 'url', 'https://…']` produces a tag no other
 * client can read.
 *
 * The available fields are NIP-94's. `url` is mandatory and the specification
 * asks for at least one other field: an `imeta` with only the url adds
 * nothing to what can already be read in the content.
 */

export const imetaSchema = z.object({
  /** The URL to download the file from. Mandatory. */
  url: z.string(),
  /** MIME type, lower case (`m` in NIP-94). */
  mime: z.string().optional(),
  /** Hexadecimal SHA-256 of the file as served. */
  sha256: z.string().optional(),
  /** SHA-256 of the **original** file, before the server's transformations. */
  sha256Originale: z.string().optional(),
  /** Size in bytes. */
  size: z.number().int().nonnegative().optional(),
  /** Pixel dimensions, `widthxheight`. */
  dim: z.string().optional(),
  /** A blurhash to show while loading. */
  blurhash: z.string().optional(),
  /** A description for whoever cannot see the image. */
  alt: z.string().optional(),
  /** A thumbnail with the same aspect ratio. */
  thumb: z.string().optional(),
  /** Preview images, at the same resolution (NIP-71). */
  image: z.array(z.string()),
  /** Duration in seconds, for audio and video (NIP-71). */
  duration: z.number().optional(),
  /** Average bitrate in bit/s (NIP-71). */
  bitrate: z.number().int().optional(),
  /** Alternative copies, in case `url` does not answer. */
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

/** Width and height in pixels, in the `<w>x<h>` form NIP-94 wants. */
export function dimensioni(larghezza: number, altezza: number): string {
  return `${Math.round(larghezza)}x${Math.round(altezza)}`
}

/** Builds the `imeta` tag from an attachment's metadata. */
export function buildImetaTag(input: ImetaInput): Tag {
  if (!input.url) throw new Error('Un tag imeta senza url non è valido (NIP-92).')

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
  // `alt` can contain spaces: it is the one awkward positional field, but the
  // specification allows it and readers split on the first space only.
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
 * Interprets an `imeta` tag.
 *
 * Every entry is split on the **first** space only: values can contain them
 * (the `alt` almost always does), and using `split(' ')` would truncate the
 * description at the first word.
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

/** Every attachment an event declares. */
export function imetaOf(event: NostrEvent): Imeta[] {
  return event.tags
    .filter((t) => t[0] === 'imeta')
    .map(parseImetaTag)
    .filter((x): x is Imeta => x !== null)
}
