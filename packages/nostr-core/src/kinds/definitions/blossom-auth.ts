import { z } from 'zod'

import { defineKind } from '../registry.js'
import { repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 24242 — a Blossom authorization (BUD-11).
 *
 * **It is never published to a relay.** It is a signed event that travels
 * inside the `Authorization` header of an HTTP request to a Blossom server,
 * and it is what proves that whoever uploads the file holds the key. It sits
 * in the ephemeral range for exactly that reason: there is no point keeping
 * it.
 *
 * The specification's constraints, all checked at build time:
 *
 *  - `t` with the operation's verb (`upload`, `get`, `list`, `delete`, `media`);
 *  - `expiration` (NIP-40) **in the future**: a token without an expiry would
 *    stay valid for ever, and whoever intercepted it could reuse it;
 *  - `x` with the blob's hash, mandatory for an upload;
 *  - a readable `content`: it is what the user sees when the extension asks
 *    them to sign, and writing an empty string there means asking them to
 *    authorize something they cannot understand.
 *
 * The `server` tag limits the token to one domain. Without it, an intercepted
 * token can be spent on any Blossom server at all until it expires.
 */

export const verbiBlossom = ['get', 'upload', 'list', 'delete', 'media'] as const
export type VerboBlossom = (typeof verbiBlossom)[number]

export const blossomAuthSchema = z.object({
  verb: z.enum(verbiBlossom),
  expiration: z.number().int().positive(),
  hashes: z.array(z.string()),
  servers: z.array(z.string()),
  content: z.string(),
})

export type BlossomAuthParsed = z.infer<typeof blossomAuthSchema>

export interface BlossomAuthInput {
  verb: VerboBlossom
  /** The absolute expiry, in unix seconds. */
  expiration: number
  /** The hashes of the blobs the token applies to. */
  hashes?: string[]
  /** The domains to limit the token to (the host name alone, not the URL). */
  servers?: string[]
  /** The explanation shown to the user at signing time. */
  content: string
}

export const blossomAuthDefinition = defineKind<BlossomAuthParsed, BlossomAuthInput>({
  kind: 24242,
  name: 'autorizzazione-blossom',
  nip: 'BUD-11',
  class: 'ephemeral',
  editable: false,
  deletable: false, // ephemeral: there is nothing to delete
  schema: blossomAuthSchema,
  feed: { eligible: false },

  parse(event) {
    const verb = tagValue(event, 't')
    const scadenza = tagValue(event, 'expiration')
    return blossomAuthSchema.parse({
      verb,
      expiration: scadenza ? Number.parseInt(scadenza, 10) : 0,
      hashes: tagValues(event, 'x'),
      servers: tagValues(event, 'server'),
      content: event.content,
    })
  },

  build(input, ctx) {
    if (input.expiration <= ctx.now) {
      throw new Error('La scadenza del token Blossom deve essere nel futuro (BUD-11).')
    }
    if (input.verb === 'upload' && (input.hashes ?? []).length === 0) {
      throw new Error(
        'Un token di upload deve dichiarare l’hash del file: senza, il server non può legarlo al blob che riceve.',
      )
    }
    if (input.content.trim() === '') {
      throw new Error(
        'Il token deve spiegare a cosa serve: è il testo che l’utente vede quando gli si chiede di firmarlo.',
      )
    }
    for (const s of input.servers ?? []) {
      if (s.includes('://') || s.includes('/')) {
        throw new Error(
          `Il tag "server" vuole il solo nome di dominio, non un URL: ricevuto "${s}".`,
        )
      }
    }

    return {
      kind: 24242,
      content: input.content,
      tags: [
        ['t', input.verb],
        ['expiration', String(input.expiration)],
        ...repeatedTags('x', input.hashes ?? []),
        ...repeatedTags('server', input.servers ?? []),
      ],
      created_at: ctx.now,
    }
  },
})
