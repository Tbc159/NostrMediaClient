import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue } from '../tags.js'

/**
 * Kind 31925 — risposta a un invito, RSVP (NIP-52).
 *
 * Punta all'evento con un tag `a`, cioe' alla sua *coordinata*
 * `<kind>:<pubkey>:<d>` e non al suo id. E' deliberato: gli eventi calendario
 * sono addressable, quindi l'organizzatore puo' modificarli e cambiare id.
 * Un RSVP legato all'id resterebbe attaccato a una versione superata.
 *
 * Il tag `e` opzionale registra invece a *quale versione* si stava rispondendo,
 * utile quando l'evento cambia dopo che qualcuno ha gia' risposto.
 */

export const rsvpStatusSchema = z.enum(['accepted', 'declined', 'tentative'])
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>

export const rsvpFreebusySchema = z.enum(['free', 'busy'])
export type RsvpFreebusy = z.infer<typeof rsvpFreebusySchema>

export const rsvpSchema = z.object({
  identifier: z.string(),
  /** Coordinata dell'evento: `<kind>:<pubkey>:<d>`. */
  eventAddress: z.string(),
  /** Id della versione dell'evento a cui si risponde. */
  eventId: z.string().optional(),
  status: rsvpStatusSchema,
  /** Disponibilita' dichiarata. Non ha senso su un rifiuto. */
  freebusy: rsvpFreebusySchema.optional(),
  /** Pubkey dell'organizzatore, per fargli arrivare la notifica. */
  organizer: z.string().optional(),
  /** Nota libera che accompagna la risposta. */
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
  // Addressable: cambiare idea significa ripubblicare con lo stesso `d`,
  // che sostituisce la risposta precedente invece di affiancarla.
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
    // Un rifiuto con "sono libero" non vuol dire nulla: NIP-52 prevede `fb`
    // solo per chi partecipa o forse partecipa.
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
