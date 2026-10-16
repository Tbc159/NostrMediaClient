import { z } from 'zod'

import { buildImetaTag, imetaOf, imetaSchema, type ImetaInput } from '../imeta.js'
import { defineKind } from '../registry.js'
import { repeatedTags, tagValues, tagsNamed } from '../tags.js'
import type { NostrEvent } from '../types.js'

/**
 * Kind 1 — a short text note (NIP-10).
 *
 * It is a *regular* event, hence immutable: there is no such thing as editing.
 * The only way to correct a note is to ask for it to be deleted (kind 5) and
 * republish it, getting a new id and losing the reactions and the replies. The
 * UI has to say so, not simulate an edit the protocol does not offer.
 */

export const noteParsedSchema = z.object({
  content: z.string(),
  /** The id of the thread's root event, when the note is a reply. */
  rootId: z.string().optional(),
  /** The id of the event being replied to directly. */
  replyToId: z.string().optional(),
  /** The pubkeys mentioned (the `p` tag). */
  mentions: z.array(z.string()),
  /** The events quoted (the `q` tag, NIP-18). */
  quotes: z.array(z.string()),
  /** The hashtags (the `t` tag), already normalised. */
  hashtags: z.array(z.string()),
  /** The attachments declared with `imeta` (NIP-92). */
  attachments: z.array(imetaSchema),
})

export type NoteParsed = z.infer<typeof noteParsedSchema>

export interface NoteInput {
  content: string
  /**
   * The note being replied to. The whole event is needed, not just the id:
   * NIP-10 wants the reply to carry the thread's root, which is derived from
   * the tags of the note being replied to.
   */
  replyTo?: NoteReplyTarget
  /** The event quoted (the `q` tag). */
  quoteId?: string
  /** The hashtags, with or without a hash sign: they get normalised. */
  hashtags?: string[]
  /** The pubkeys to mention besides the ones inherited from the thread. */
  mentions?: string[]
  /**
   * The attachments (NIP-92).
   *
   * A note with an attachment is the only way to publish a file that *any*
   * social client shows: the dedicated media kinds (20, 21, 22) are more
   * precise but are read only by whoever filters for them.
   */
  attachments?: ImetaInput[]
}

export interface NoteReplyTarget {
  id: string
  pubkey: string
  /** The root of the thread it belongs to, when already known. */
  rootId?: string
  /** The pubkeys already involved in the thread, to carry into the reply. */
  participants?: string[]
}

/**
 * Extracts the root and the addressee from an event according to NIP-10.
 *
 * The NIP provides for marked `e` tags (`root` / `reply`), but there is a
 * mountain of old events with unmarked tags, where the convention was: the
 * first `e` = the root, the last `e` = the direct reply. We handle both forms,
 * otherwise the historical threads come out broken.
 */
function extractThread(event: NostrEvent): { rootId?: string; replyToId?: string } {
  const eTags = tagsNamed(event, 'e')
  if (eTags.length === 0) return {}

  // With exactOptionalPropertyTypes a property that is present but undefined
  // is not the same as an absent property: the keys are added only when they
  // really have a value.
  const componi = (
    rootId?: string,
    replyToId?: string,
  ): { rootId?: string; replyToId?: string } => ({
    ...(rootId !== undefined ? { rootId } : {}),
    ...(replyToId !== undefined ? { replyToId } : {}),
  })

  const marcato = (marker: string): string | undefined => eTags.find((t) => t[3] === marker)?.[1]

  const root = marcato('root')
  const reply = marcato('reply')
  if (root !== undefined || reply !== undefined) {
    // A direct reply to the root carries the "root" marker only.
    return componi(root, reply ?? root)
  }

  const primo = eTags[0]?.[1]
  const ultimo = eTags[eTags.length - 1]?.[1]
  if (eTags.length === 1) return componi(primo, primo)
  return componi(primo, ultimo)
}

export const noteDefinition = defineKind<NoteParsed, NoteInput>({
  kind: 1,
  name: 'nota',
  nip: 'NIP-10',
  class: 'regular',
  editable: false, // immutable by construction: see the comment at the top
  deletable: true,
  schema: noteParsedSchema,
  feed: { eligible: true },
  renderer: 'note',

  parse(event) {
    const { rootId, replyToId } = extractThread(event)
    return noteParsedSchema.parse({
      content: event.content,
      ...(rootId !== undefined ? { rootId } : {}),
      ...(replyToId !== undefined ? { replyToId } : {}),
      mentions: tagValues(event, 'p'),
      quotes: tagValues(event, 'q'),
      hashtags: tagValues(event, 't'),
      attachments: imetaOf(event),
    })
  },

  build(input, ctx) {
    const tags: string[][] = []

    if (input.replyTo) {
      const { id, pubkey, rootId, participants = [] } = input.replyTo

      if (rootId && rootId !== id) {
        // A reply inside a thread: both the root and the parent are marked.
        tags.push(['e', rootId, '', 'root'])
        tags.push(['e', id, '', 'reply'])
      } else {
        // A direct reply to the root: a single tag, marked "root".
        tags.push(['e', id, '', 'root'])
      }

      // NIP-10: the reply carries the thread's authors, so they get the
      // notification. Deduplicated by repeatedTags.
      tags.push(...repeatedTags('p', [pubkey, ...participants, ...(input.mentions ?? [])]))
    } else if (input.mentions?.length) {
      tags.push(...repeatedTags('p', input.mentions))
    }

    if (input.quoteId) tags.push(['q', input.quoteId])

    /*
     * NIP-92: «Each imeta tag SHOULD match a URL in the event content».
     * An attachment declared in the tag alone would be shown by nobody:
     * clients look for the URL in the text and replace it with the preview.
     * The missing urls are appended rather than leaving the note mute.
     */
    let contenuto = input.content
    for (const allegato of input.attachments ?? []) {
      tags.push(buildImetaTag(allegato))
      if (!contenuto.includes(allegato.url)) {
        contenuto = contenuto.trim() === '' ? allegato.url : `${contenuto}\n\n${allegato.url}`
      }
    }

    if (input.hashtags?.length) {
      tags.push(...repeatedTags('t', input.hashtags))
    }

    return {
      kind: 1,
      content: contenuto,
      tags,
      created_at: ctx.now,
    }
  },
})
