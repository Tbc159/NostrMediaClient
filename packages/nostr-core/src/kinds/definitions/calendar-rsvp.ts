import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue } from '../tags.js'

/**
 * Kind 31925 — the answer to an invitation, an RSVP (NIP-52).
 *
 * It points at the event with an `a` tag, that is at its *coordinate*
 * `<kind>:<pubkey>:<d>` and not at its id. That is deliberate: calendar events
 * are addressable, so the organiser can edit them and change the id. An RSVP
 * tied to the id would stay attached to a superseded version.
 *
 * The optional `e` tag records instead *which version* was being answered,
 * which is useful when the event changes after somebody has already answered.
 */

export const rsvpStatusSchema = z.enum(['accepted', 'declined', 'tentative'])
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>

export const rsvpFreebusySchema = z.enum(['free', 'busy'])
export type RsvpFreebusy = z.infer<typeof rsvpFreebusySchema>

export const rsvpSchema = z.object({
  identifier: z.string(),
  /** The event's coordinate: `<kind>:<pubkey>:<d>`. */
  eventAddress: z.string(),
  /** The id of the version of the event being answered. */
  eventId: z.string().optional(),
  status: rsvpStatusSchema,
  /** The declared availability. It makes no sense on a refusal. */
  freebusy: rsvpFreebusySchema.optional(),
  /** The organiser's pubkey, so the notification reaches them. */
  organizer: z.string().optional(),
  /** A free-form note accompanying the answer. */
  note: z.string(),
})

export type RsvpParsed = z.infer<typeof rsvpSchema>

export interface RsvpInput {
  identifier: string
  eventAddress: string
  eventId?: string
  status: RsvpStatus
  freebusy?: RsvpFreebusy
  organizer?: string
  note?: string
}

export const calendarRsvpDefinition = defineKind<RsvpParsed, RsvpInput>({
  kind: 31925,
  name: 'rsvp-calendario',
  nip: 'NIP-52',
  class: 'addressable',
  // Addressable: changing your mind means republishing with the same `d`,
  // which replaces the previous answer instead of sitting beside it.
  editable: true,
  deletable: true,
  schema: rsvpSchema,
  feed: { eligible: false },
  renderer: 'calendar-rsvp',

  identifier: (input) => input.identifier,

  parse(event) {
    const eventAddress = tagValue(event, 'a')
    if (eventAddress === undefined) {
      throw new Error(`kind 31925 senza tag "a": non si sa a quale evento risponda (${event.id})`)
    }

    const status = tagValue(event, 'status')
    const freebusy = tagValue(event, 'fb')
    const eventId = tagValue(event, 'e')
    const organizer = tagValue(event, 'p')

    return rsvpSchema.parse({
      identifier: tagValue(event, 'd') ?? '',
      eventAddress,
      ...(eventId !== undefined ? { eventId } : {}),
      status: rsvpStatusSchema.parse(status),
      ...(freebusy !== undefined ? { freebusy: rsvpFreebusySchema.parse(freebusy) } : {}),
      ...(organizer !== undefined ? { organizer } : {}),
      note: event.content,
    })
  },

  build(input, ctx) {
    // A refusal with "I am free" means nothing: NIP-52 provides `fb` only for
    // whoever is attending, or might be.
    const freebusy = input.status === 'declined' ? undefined : input.freebusy

    return {
      kind: 31925,
      content: input.note ?? '',
      tags: [
        ['d', input.identifier],
        ['a', input.eventAddress],
        ...optionalTag('e', input.eventId),
        ['status', input.status],
        ...optionalTag('fb', freebusy),
        ...optionalTag('p', input.organizer),
      ],
      created_at: ctx.now,
    }
  },
})
