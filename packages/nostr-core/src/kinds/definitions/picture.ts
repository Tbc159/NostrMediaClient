import { z } from 'zod'

import { buildImetaTag, imetaOf, imetaSchema, type ImetaInput } from '../imeta.js'
import { defineKind } from '../registry.js'
import { normalizeHashtag, optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 20 — post con immagini in primo piano (NIP-68).
 *
 * La differenza con una nota che contiene un link a un'immagine non e'
 * estetica: qui le immagini sono **il** contenuto, dichiarate in tag `imeta` e
 * non nel testo. Un client che filtra per kind 20 sa in anticipo di ricevere
 * eventi con almeno un'immagine, e puo' impaginare una galleria senza doverli
 * prima scaricare e ispezionare uno per uno.
 *
 * Conseguenza: **un kind 20 senza allegati non ha senso** e viene rifiutato in
 * costruzione. Se non c'e' un'immagine, quello che si vuole scrivere e' una
 * nota (kind 1).
 */

export const pictureSchema = z.object({
  /** Descrizione del post: sta nel content. */
  content: z.string(),
  /** Titolo breve (tag `title`). */
  title: z.string().optional(),
  /** Immagini del post, in ordine. */
  images: z.array(imetaSchema),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  /** Motivo dell'avviso di contenuto sensibile, se presente. */
  contentWarning: z.string().optional(),
})

export type PictureParsed = z.infer<typeof pictureSchema>

export interface PictureInput {
  content: string
  title?: string
  images: ImetaInput[]
  hashtags?: string[]
  mentions?: string[]
  contentWarning?: string
}

export const pictureDefinition = defineKind<PictureParsed, PictureInput>({
  kind: 20,
  name: 'post-immagini',
  nip: 'NIP-68',
  class: 'regular',
  editable: false, // regolare: immutabile, come il kind 1
  deletable: true,
  schema: pictureSchema,
  feed: { eligible: true, requiresMedia: true },
  renderer: 'picture',

  parse(event) {
    const title = tagValue(event, 'title')
    const contentWarning = event.tags.find((t) => t[0] === 'content-warning')?.[1]

    return pictureSchema.parse({
      content: event.content,
      ...(title !== undefined ? { title } : {}),
      images: imetaOf(event),
      hashtags: tagValues(event, 't').map(normalizeHashtag),
      mentions: tagValues(event, 'p'),
      ...(contentWarning !== undefined ? { contentWarning } : {}),
    })
  },

  build(input, ctx) {
    if (input.images.length === 0) {
      throw new Error(
        'Un kind 20 deve portare almeno un’immagine. Per un testo senza immagini usa una nota (kind 1).',
      )
    }

    const imeta = input.images.map(buildImetaTag)

    // NIP-68 chiede di ripetere fuori dall'imeta il tipo MIME e gli hash:
    // servono ai relay per filtrare, e un filtro non sa leggere dentro un tag
    // variadico.
    const mime = [...new Set(input.images.map((i) => i.mime).filter(Boolean))] as string[]
    const hash = input.images.map((i) => i.sha256).filter(Boolean) as string[]

    return {
      kind: 20,
      content: input.content,
      tags: [
        ...optionalTag('title', input.title),
        ...imeta,
        ...repeatedTags('m', mime),
        ...repeatedTags('x', hash),
        ...repeatedTags('t', (input.hashtags ?? []).map(normalizeHashtag)),
        ...repeatedTags('p', input.mentions ?? []),
        ...(input.contentWarning !== undefined ? [['content-warning', input.contentWarning]] : []),
      ],
      created_at: ctx.now,
    }
  },
})
