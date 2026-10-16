import { z } from 'zod'

import { buildImetaTag, imetaOf, imetaSchema, type ImetaInput } from '../imeta.js'
import { defineKind } from '../registry.js'
import { optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 20 — a post with the images to the fore (NIP-68).
 *
 * The difference from a note containing a link to an image is not aesthetic:
 * here the images are **the** content, declared in `imeta` tags and not in the
 * text. A client filtering for kind 20 knows in advance that it will receive
 * events with at least one image, and can lay out a gallery without having to
 * download and inspect them one by one first.
 *
 * The consequence: **a kind 20 without attachments makes no sense** and is
 * refused at build time. If there is no image, what you want to write is a
 * note (kind 1).
 */

export const pictureSchema = z.object({
  /** The post's description: it sits in the content. */
  content: z.string(),
  /** A short title (the `title` tag). */
  title: z.string().optional(),
  /** The post's images, in order. */
  images: z.array(imetaSchema),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  /** The reason for the sensitive-content warning, when there is one. */
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
  editable: false, // regular: immutable, like kind 1
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
      hashtags: tagValues(event, 't'),
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

    // NIP-68 asks for the MIME type and the hashes to be repeated outside the
    // imeta: the relays need them to filter, and a filter cannot read inside a
    // variadic tag.
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
        ...repeatedTags('t', input.hashtags ?? []),
        ...repeatedTags('p', input.mentions ?? []),
        ...(input.contentWarning !== undefined ? [['content-warning', input.contentWarning]] : []),
      ],
      created_at: ctx.now,
    }
  },
})
