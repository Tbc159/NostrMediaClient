import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 30023 — a long-form article (NIP-23).
 *
 * The `content` is **Markdown**, with two explicit prohibitions in the
 * specification: no HTML, and no hard line breaks at the end of a line. The
 * second looks like a typographic detail and is not: text wrapped at 80
 * columns reads badly on a phone, where the lines get broken a second time.
 *
 * It is addressable, hence **really editable**: republishing with the same `d`
 * replaces the previous version. Hence the distinction between two dates that
 * is easy to confuse:
 *
 *   - `created_at` is the last edit;
 *   - `published_at` is the first publication, and never changes.
 *
 * If `published_at` is updated on every save, the article looks published
 * afresh every time and climbs other people's chronological feeds for no
 * reason.
 */

export const articleSchema = z.object({
  /** The article's body, in Markdown. */
  content: z.string(),
  identifier: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  image: z.string().optional(),
  /** The first publication, in unix seconds. It does not change with edits. */
  publishedAt: z.number().int().positive().optional(),
  hashtags: z.array(z.string()),
})

export type ArticleParsed = z.infer<typeof articleSchema>

export interface ArticleInput {
  content: string
  identifier: string
  title?: string
  summary?: string
  image?: string
  publishedAt?: number
  hashtags?: string[]
}

/** A readable identifier derived from the title, for a `d` tag that speaks. */
export function slugFromTitle(titolo: string): string {
  const base = titolo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // away with the accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  // A title made of symbols alone would leave an empty identifier, which as a
  // `d` tag would mean "the article with no name" and collide with others.
  return base.length > 0 ? base : `articolo-${Date.now().toString(36)}`
}

function creaDefinizioneArticolo(kind: 30023 | 30024, nome: string) {
  return defineKind<ArticleParsed, ArticleInput>({
    kind,
    name: nome,
    nip: 'NIP-23',
    class: 'addressable',
    editable: true,
    deletable: true,
    schema: articleSchema,
    feed: { eligible: false },
    renderer: 'article',

    identifier: (input) => input.identifier,

    parse(event) {
      const pubblicato = tagValue(event, 'published_at')
      const publishedAt = pubblicato ? Number.parseInt(pubblicato, 10) : undefined
      const opzionali = {
        title: tagValue(event, 'title'),
        summary: tagValue(event, 'summary'),
        image: tagValue(event, 'image'),
        ...(publishedAt !== undefined && Number.isFinite(publishedAt) ? { publishedAt } : {}),
      }

      return articleSchema.parse({
        content: event.content,
        identifier: tagValue(event, 'd') ?? '',
        hashtags: tagValues(event, 't'),
        ...Object.fromEntries(Object.entries(opzionali).filter(([, v]) => v !== undefined)),
      })
    },

    build(input, ctx) {
      if (input.identifier.trim() === '') {
        throw new Error(
          'Un articolo ha bisogno di un identificatore: e’ il tag `d` che rende la modifica una sostituzione invece di un doppione.',
        )
      }
      if (/<[a-z][\s\S]*>/i.test(input.content)) {
        // NIP-23: «MUST NOT support adding HTML to Markdown».
        throw new Error(
          'NIP-23 non ammette HTML dentro il Markdown: i client che lo renderizzano lo mostrerebbero come testo, quelli che non lo fanno lo eseguirebbero.',
        )
      }

      return {
        kind,
        content: input.content,
        tags: [
          ['d', input.identifier],
          ...optionalTag('title', input.title),
          ...optionalTag('summary', input.summary),
          ...optionalTag('image', input.image),
          // On the first publication it coincides with created_at; on later
          // edits the original one has to be passed, not recomputed.
          ['published_at', String(input.publishedAt ?? ctx.now)],
          ...repeatedTags('t', input.hashtags ?? []),
        ],
        created_at: ctx.now,
      }
    },
  })
}

export const articleDefinition = creaDefinizioneArticolo(30023, 'articolo')

/**
 * Kind 30024 — a long-form draft.
 *
 * **NIP-23 declares it deprecated**: the recommended way for drafts is now
 * NIP-37 (kind 31234, NIP-44-encrypted to yourself). We keep it registered to
 * *read* the drafts users already have, not to create new ones.
 *
 * The practical difference matters: a 30024 is in the clear, so anyone with
 * access to the relay reads it. Calling it a "draft" is misleading — it is an
 * article published in a quiet place.
 */
export const articleDraftDefinition = creaDefinizioneArticolo(30024, 'bozza-articolo-legacy')
