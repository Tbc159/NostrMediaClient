import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue } from '../tags.js'

/**
 * Kind 31234 — an encrypted draft (NIP-37).
 *
 * It contains an **unsigned** event of another kind, serialised and encrypted
 * with NIP-44 to your own key. It replaces kind 30024, which NIP-23 declares
 * deprecated: that one ended up on the relay *in the clear*, and calling it a
 * draft was misleading.
 *
 * A design note: this definition **neither encrypts nor decrypts**. To it the
 * `content` is an opaque string, and there are two reasons:
 *
 *   1. `build()` is synchronous by contract, whereas with NIP-07 the
 *      encryption happens inside the extension and returns a `Promise`;
 *   2. the registry describes *formats*, it does not hold keys. Passing
 *      cryptographic material through it would tie it to the active login
 *      method.
 *
 * The encryption sits in `wrapDraft`/`unwrapDraft`, which take a cipher.
 *
 * **An empty `content` means a deleted draft**, not an empty one: the
 * specification says so, and it is the only way to delete one without hoping
 * the relay honours a kind 5 request.
 */

export const draftWrapSchema = z.object({
  identifier: z.string(),
  /** The contained event's kind, from the `k` tag. */
  draftKind: z.number().int().nonnegative(),
  /** The encrypted content. Empty when the draft has been deleted. */
  ciphertext: z.string(),
  /** The NIP-40 expiry, in unix seconds. */
  expiration: z.number().int().positive().optional(),
  /** True when the content is empty, that is when the draft has been deleted. */
  cancellata: z.boolean(),
})

export type DraftWrapParsed = z.infer<typeof draftWrapSchema>

export interface DraftWrapInput {
  identifier: string
  draftKind: number
  /** Already encrypted. An empty string deletes the draft. */
  ciphertext: string
  expiration?: number
}

export const draftWrapDefinition = defineKind<DraftWrapParsed, DraftWrapInput>({
  kind: 31234,
  name: 'bozza-cifrata',
  nip: 'NIP-37',
  class: 'addressable',
  editable: true,
  deletable: true,
  schema: draftWrapSchema,
  feed: { eligible: false },
  renderer: 'draft',

  identifier: (input) => input.identifier,

  parse(event) {
    const d = tagValue(event, 'd')
    if (d === undefined) throw new Error(`kind 31234 senza tag "d": evento ${event.id}`)

    const k = tagValue(event, 'k')
    if (k === undefined) {
      throw new Error(`kind 31234 senza tag "k", che NIP-37 richiede: evento ${event.id}`)
    }
    const draftKind = Number.parseInt(k, 10)
    if (!Number.isFinite(draftKind) || draftKind < 0) {
      throw new Error(`kind 31234 con tag "k" non numerico ("${k}"): evento ${event.id}`)
    }

    const scadenza = tagValue(event, 'expiration')
    const expiration = scadenza ? Number.parseInt(scadenza, 10) : undefined

    return draftWrapSchema.parse({
      identifier: d,
      draftKind,
      ciphertext: event.content,
      ...(expiration !== undefined && Number.isFinite(expiration) && expiration > 0
        ? { expiration }
        : {}),
      cancellata: event.content.trim() === '',
    })
  },

  build(input, ctx) {
    if (input.identifier.trim() === '') {
      throw new Error(
        'Una bozza ha bisogno di un identificatore: e’ il tag `d` che la rende sostituibile.',
      )
    }
    if (input.draftKind === 31234) {
      // A draft of a draft makes no sense and would nest for ever.
      throw new Error('Il tag `k` deve indicare il kind dell’evento in bozza, non 31234.')
    }

    return {
      kind: 31234,
      content: input.ciphertext,
      tags: [
        ['d', input.identifier],
        ['k', String(input.draftKind)],
        ...optionalTag(
          'expiration',
          input.expiration !== undefined ? String(input.expiration) : undefined,
        ),
      ],
      created_at: ctx.now,
    }
  },
})

/**
 * Kind 10013 — the relays for private content (NIP-37).
 *
 * The list of relays sits **encrypted in the content**, not in the tags: an
 * event's tags are public, and knowing which relays a person keeps their
 * drafts on is already a piece of information.
 *
 * As with the 31234, the content stays opaque here: the encryption goes
 * through `wrapPrivateRelays`.
 */
export const privateRelaysSchema = z.object({
  ciphertext: z.string(),
})

export type PrivateRelaysParsed = z.infer<typeof privateRelaysSchema>

export interface PrivateRelaysInput {
  /** Already encrypted. */
  ciphertext: string
}

export const privateRelaysDefinition = defineKind<PrivateRelaysParsed, PrivateRelaysInput>({
  kind: 10013,
  name: 'relay-privati',
  nip: 'NIP-37',
  class: 'replaceable',
  editable: true,
  deletable: true,
  schema: privateRelaysSchema,
  feed: { eligible: false },

  parse(event) {
    return privateRelaysSchema.parse({ ciphertext: event.content })
  },

  build(input, ctx) {
    return {
      kind: 10013,
      content: input.ciphertext,
      tags: [],
      created_at: ctx.now,
    }
  },
})
