import { z } from 'zod'

import { defineKind } from '../registry.js'
import { tagsNamed } from '../tags.js'

/**
 * Kind 10002 — the relays a key reads from and writes to (NIP-65).
 *
 * It is how the rest of the network finds a key's events: the feed service
 * looks a podcast's key up on the indexer relays, reads its 10002 and asks the
 * write relays listed there. A key born a minute ago has none, and without it
 * the service would query its fallback relays only and might never see the
 * episodes. That is why NMC writes one when it creates a dedicated key.
 *
 * One `r` tag per relay: with no marker the relay is used both ways, with
 * `read` or `write` only that way.
 */

export const relayListSchema = z.object({
  relays: z.array(
    z.object({
      url: z.string(),
      lettura: z.boolean(),
      scrittura: z.boolean(),
    }),
  ),
})

export type RelayListParsed = z.infer<typeof relayListSchema>

export interface RelayListInput {
  relays: { url: string; lettura: boolean; scrittura: boolean }[]
}

const URL_RELAY = /^wss?:\/\/[^\s/]+/i

export const relayListDefinition = defineKind<RelayListParsed, RelayListInput>({
  kind: 10002,
  name: 'lista-relay',
  nip: 'NIP-65',
  class: 'replaceable',
  editable: true,
  deletable: true,
  schema: relayListSchema,
  feed: { eligible: false },

  parse(event) {
    return relayListSchema.parse({
      relays: tagsNamed(event, 'r')
        .filter((t) => typeof t[1] === 'string' && URL_RELAY.test(t[1]))
        .map((t) => ({
          url: t[1] as string,
          lettura: t[2] !== 'write',
          scrittura: t[2] !== 'read',
        })),
    })
  },

  build(input, ctx) {
    // One entry per relay: the same address written twice, once to read and
    // once to write, is the same relay used both ways.
    const perUrl = new Map<string, { lettura: boolean; scrittura: boolean }>()
    for (const r of input.relays) {
      const url = r.url.trim().replace(/\/+$/, '')
      if (!URL_RELAY.test(url)) {
        throw new Error(`«${r.url}» non è l’indirizzo di un relay (wss://…).`)
      }
      if (!r.lettura && !r.scrittura) continue
      const prima = perUrl.get(url) ?? { lettura: false, scrittura: false }
      perUrl.set(url, {
        lettura: prima.lettura || r.lettura,
        scrittura: prima.scrittura || r.scrittura,
      })
    }
    if (perUrl.size === 0) {
      throw new Error(
        'Una lista di relay vuota direbbe alla rete di non cercare questa chiave da nessuna parte.',
      )
    }
    return {
      kind: 10002,
      content: '',
      tags: [...perUrl].map(([url, uso]) =>
        uso.lettura && uso.scrittura ? ['r', url] : ['r', url, uso.lettura ? 'read' : 'write'],
      ),
      created_at: ctx.now,
    }
  },
})
