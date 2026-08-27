import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue, tagValues } from '../tags.js'

/**
 * Kind 1063 — metadati di un file (NIP-94).
 *
 * Descrive un file caricato da qualche parte, indipendentemente dal post che
 * lo mostra. Serve a due cose che un `imeta` dentro un altro evento non fa:
 * rendere il file interrogabile per hash (`#x`), e conservarne la scheda anche
 * quando il post che lo conteneva viene cancellato.
 *
 * Nota sui due hash: `x` e' l'hash del file **servito**, `ox` quello
 * dell'**originale** prima delle trasformazioni del server. Se il server
 * ricomprime l'immagine i due divergono, e confonderli significa non
 * ritrovare piu' il file caricato.
 */

export const fileMetadataSchema = z.object({
  /** Descrizione del file: sta nel content. */
  content: z.string(),
  url: z.string(),
  mime: z.string().optional(),
  /** SHA-256 del file servito. */
  sha256: z.string().optional(),
  /** SHA-256 dell'originale, prima delle trasformazioni del server. */
  sha256Originale: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  dim: z.string().optional(),
  blurhash: z.string().optional(),
  alt: z.string().optional(),
  thumb: z.string().optional(),
  summary: z.string().optional(),
  fallback: z.array(z.string()),
})

export type FileMetadataParsed = z.infer<typeof fileMetadataSchema>

export interface FileMetadataInput {
  content?: string
  url: string
  mime?: string
  sha256?: string
  sha256Originale?: string
  size?: number
  dim?: string
  blurhash?: string
  alt?: string
  thumb?: string
  summary?: string
  fallback?: string[]
}

export const fileMetadataDefinition = defineKind<FileMetadataParsed, FileMetadataInput>({
  kind: 1063,
  name: 'metadati-file',
  nip: 'NIP-94',
  class: 'regular',
  editable: false,
  deletable: true,
  schema: fileMetadataSchema,
  feed: { eligible: false },
  renderer: 'file',

  parse(event) {
    const url = tagValue(event, 'url')
    if (url === undefined) throw new Error(`kind 1063 senza tag "url": evento ${event.id}`)

    const numero = (nome: string): number | undefined => {
      const grezzo = tagValue(event, nome)
      if (grezzo === undefined) return undefined
      const n = Number.parseInt(grezzo, 10)
      return Number.isFinite(n) && n >= 0 ? n : undefined
    }

    const opzionali = {
      mime: tagValue(event, 'm'),
      sha256: tagValue(event, 'x'),
      sha256Originale: tagValue(event, 'ox'),
      size: numero('size'),
      dim: tagValue(event, 'dim'),
      blurhash: tagValue(event, 'blurhash'),
      alt: tagValue(event, 'alt'),
      thumb: tagValue(event, 'thumb'),
      summary: tagValue(event, 'summary'),
    }

    return fileMetadataSchema.parse({
      content: event.content,
      url,
      fallback: tagValues(event, 'fallback'),
      ...Object.fromEntries(Object.entries(opzionali).filter(([, v]) => v !== undefined)),
    })
  },

  build(input, ctx) {
    return {
      kind: 1063,
      content: input.content ?? '',
      tags: [
        ['url', input.url],
        ...optionalTag('m', input.mime),
        ...optionalTag('x', input.sha256),
        ...optionalTag('ox', input.sha256Originale),
        ...optionalTag('size', input.size !== undefined ? String(input.size) : undefined),
        ...optionalTag('dim', input.dim),
        ...optionalTag('blurhash', input.blurhash),
        ...optionalTag('thumb', input.thumb),
        ...optionalTag('summary', input.summary),
        ...optionalTag('alt', input.alt),
        ...(input.fallback ?? []).map((f) => ['fallback', f]),
      ],
      created_at: ctx.now,
    }
  },
})
