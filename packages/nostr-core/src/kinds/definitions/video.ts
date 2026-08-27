import { z } from 'zod'

import { buildImetaTag, imetaOf, imetaSchema, type ImetaInput } from '../imeta.js'
import { defineKind } from '../registry.js'
import { normalizeHashtag, optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'
import type { NostrEvent } from '../types.js'

/**
 * Kind 21 e 22 — video (NIP-71).
 *
 * Due kind per la stessa cosa, distinti solo dal formato d'uso: 21 per i video
 * normali, tendenzialmente orizzontali e lunghi; 22 per gli short verticali.
 * La specifica e' esplicita nel dire che la distinzione e' *stilistica* e non
 * tecnica — niente impedisce a uno short di essere lungo — ma serve al client
 * a scegliere l'esperienza di visione, che e' diversa nei due casi.
 *
 * Il `title` e' **obbligatorio** in entrambi, a differenza del kind 20.
 */

export const videoSchema = z.object({
  /** Descrizione o sommario: sta nel content. */
  content: z.string(),
  title: z.string(),
  /** Varianti del video: risoluzioni diverse, tracce audio, formati. */
  variants: z.array(imetaSchema),
  publishedAt: z.number().int().positive().optional(),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  alt: z.string().optional(),
  contentWarning: z.string().optional(),
})

export type VideoParsed = z.infer<typeof videoSchema>

export interface VideoInput {
  content?: string
  title: string
  variants: ImetaInput[]
  publishedAt?: number
  hashtags?: string[]
  mentions?: string[]
  alt?: string
  contentWarning?: string
}

function creaDefinizioneVideo(kind: 21 | 22, nome: string, renderer: string) {
  return defineKind<VideoParsed, VideoInput>({
    kind,
    name: nome,
    nip: 'NIP-71',
    class: 'regular',
    editable: false,
    deletable: true,
    schema: videoSchema,
    feed: { eligible: true, requiresMedia: true },
    renderer,

    parse(event: NostrEvent) {
      const title = tagValue(event, 'title')
      if (title === undefined) {
        throw new Error(`kind ${kind} senza tag "title", che NIP-71 richiede: evento ${event.id}`)
      }

      const pubblicato = tagValue(event, 'published_at')
      const publishedAt = pubblicato ? Number.parseInt(pubblicato, 10) : undefined
      const alt = tagValue(event, 'alt')
      const contentWarning = event.tags.find((t) => t[0] === 'content-warning')?.[1]

      return videoSchema.parse({
        content: event.content,
        title,
        variants: imetaOf(event),
        ...(publishedAt !== undefined && Number.isFinite(publishedAt) ? { publishedAt } : {}),
        hashtags: tagValues(event, 't').map(normalizeHashtag),
        mentions: tagValues(event, 'p'),
        ...(alt !== undefined ? { alt } : {}),
        ...(contentWarning !== undefined ? { contentWarning } : {}),
      })
    },

    build(input, ctx) {
      if (input.title.trim() === '') {
        throw new Error('NIP-71 richiede un titolo per i video.')
      }
      if (input.variants.length === 0) {
        throw new Error('Un evento video deve dichiarare almeno una variante del file.')
      }

      return {
        kind,
        content: input.content ?? '',
        tags: [
          ['title', input.title],
          ...input.variants.map(buildImetaTag),
          ...optionalTag(
            'published_at',
            input.publishedAt !== undefined ? String(input.publishedAt) : String(ctx.now),
          ),
          ...repeatedTags('t', (input.hashtags ?? []).map(normalizeHashtag)),
          ...repeatedTags('p', input.mentions ?? []),
          ...optionalTag('alt', input.alt),
          ...(input.contentWarning !== undefined
            ? [['content-warning', input.contentWarning]]
            : []),
        ],
        created_at: ctx.now,
      }
    },
  })
}

export const videoDefinition = creaDefinizioneVideo(21, 'video', 'video')
export const shortVideoDefinition = creaDefinizioneVideo(22, 'video-corto', 'video')
