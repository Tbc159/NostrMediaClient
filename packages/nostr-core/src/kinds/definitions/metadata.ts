import { z } from 'zod'

import { defineKind } from '../registry.js'

/**
 * Kind 0 — the user profile (NIP-01).
 *
 * The content is a JSON object inside `content`, not in the tags. No field is
 * mandatory and anyone can add fields of their own, so the parsing has to be
 * tolerant: a malformed profile must not stop the rest of the application
 * being shown.
 *
 * **The fields we do not know are kept.** There is a single profile and it is
 * replaceable: saving it from here rewrites what was there. A client that
 * writes `pronouns` or `birthday` — real fields, outside NIP-01 — would see
 * them vanish on the first save made with us. The schema therefore does not
 * discard the unknown: it sets it aside and rewrites it as it was. The same
 * rule as for the tags holds: what we cannot read is not ours to delete.
 */

const profileNoti = z.object({
  name: z.string().optional(),
  display_name: z.string().optional(),
  about: z.string().optional(),
  picture: z.string().optional(),
  banner: z.string().optional(),
  website: z.string().optional(),
  /** The NIP-05 identifier, e.g. `name@domain.tld`. */
  nip05: z.string().optional(),
  /** The Lightning address for zaps (NIP-57). */
  lud16: z.string().optional(),
  lud06: z.string().optional(),
  /** The profile declares itself a bot. */
  bot: z.boolean().optional(),
})

/**
 * The real schema: the known fields plus any other, kept as it is.
 *
 * `catchall` is the difference between «I read the profile» and «I rewrite the
 * profile throwing away what I do not understand».
 */
export const profileSchema = profileNoti.catchall(z.unknown())

export type Profile = z.infer<typeof profileSchema>

export const metadataDefinition = defineKind<Profile, Profile>({
  kind: 0,
  name: 'profilo',
  nip: 'NIP-01',
  class: 'replaceable',
  editable: true,
  deletable: false, // deleting your own profile is not a sensible operation
  schema: profileSchema,
  feed: { eligible: false },
  renderer: 'profile',

  parse(event) {
    let grezzo: unknown
    try {
      grezzo = JSON.parse(event.content)
    } catch {
      throw new Error(`profilo con content non JSON: evento ${event.id}`)
    }

    // A known field of the wrong type must not cost us all the rest: we try
    // again keeping only what survived, plus the unknown.
    const esito = profileSchema.safeParse(grezzo)
    if (esito.success) return esito.data
    return typeof grezzo === 'object' && grezzo !== null ? { ...(grezzo as Profile) } : {}
  },

  build(input, ctx) {
    // The absent fields must not be written as null: a client re-reading the
    // profile would read them as "set to nothing" rather than "not set". Other
    // people's fields pass through here like the rest: they arrive from `parse`
    // inside the same object and go back into the JSON without being read.
    const pulito = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
    )

    return {
      kind: 0,
      content: JSON.stringify(pulito),
      tags: [],
      created_at: ctx.now,
    }
  },
})

/** The name to display, with the various fallbacks in order of preference. */
export function displayName(profile: Profile | undefined, pubkey: string): string {
  return (
    profile?.display_name?.trim() ||
    profile?.name?.trim() ||
    `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
  )
}
