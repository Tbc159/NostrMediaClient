import { z } from 'zod'

import { defineKind } from '../registry.js'
import { tagsNamed } from '../tags.js'

/**
 * Kind 5 — a deletion request (NIP-09).
 *
 * The author asks relays and clients to stop showing some of their own
 * events. It is a request, not a guarantee: a relay may keep the event, a
 * client may still show it. NMC sends one in a single case, when an
 * episode's file is replaced: a kind 54 cannot be edited, so the new version
 * is another event, and without this request the Nostr clients that read the
 * episodes directly would show both.
 *
 * One `e` tag per event, and one `k` tag per kind involved, as NIP-09 asks.
 * The content is the reason, readable by people.
 */

export const deletionSchema = z.object({
  eventi: z.array(z.string()),
  kinds: z.array(z.number().int().nonnegative()),
  motivo: z.string(),
})

export type DeletionParsed = z.infer<typeof deletionSchema>

export interface DeletionInput {
  eventi: { id: string; kind: number }[]
  motivo?: string
}

const ID = /^[0-9a-f]{64}$/

export const deletionDefinition = defineKind<DeletionParsed, DeletionInput>({
  kind: 5,
  name: 'richiesta-di-cancellazione',
  nip: 'NIP-09',
  class: 'regular',
  editable: false,
  deletable: false,
  schema: deletionSchema,
  feed: { eligible: false },

  parse(event) {
    return deletionSchema.parse({
      eventi: tagsNamed(event, 'e')
        .map((t) => t[1])
        .filter((id): id is string => typeof id === 'string' && ID.test(id)),
      kinds: tagsNamed(event, 'k')
        .map((t) => Number(t[1]))
        .filter((k) => Number.isInteger(k) && k >= 0),
      motivo: event.content,
    })
  },

  build(input, ctx) {
    if (input.eventi.length === 0) {
      throw new Error('Una richiesta di cancellazione ha bisogno di almeno un evento.')
    }
    for (const e of input.eventi) {
      if (!ID.test(e.id)) throw new Error(`«${e.id}» non è l’id di un evento.`)
    }
    const ids = [...new Set(input.eventi.map((e) => e.id))]
    const kinds = [...new Set(input.eventi.map((e) => e.kind))]
    return {
      kind: 5,
      content: input.motivo?.trim() ?? '',
      tags: [...ids.map((id) => ['e', id]), ...kinds.map((k) => ['k', String(k)])],
      created_at: ctx.now,
    }
  },
})
