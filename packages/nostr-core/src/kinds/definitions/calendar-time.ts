import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue, tagValues } from '../tags.js'
import {
  buildDayTags,
  buildSharedTags,
  calendarSharedSchema,
  dayIndex,
  parseShared,
  timezoneSchema,
  type CalendarSharedInput,
} from './calendar-common.js'

/**
 * Kind 31923 — a calendar event with a time (NIP-52).
 *
 * The delicate point of the whole NIP is here. `start` is a unix timestamp,
 * hence an absolute instant, but `start_tzid` says which zone the event is to
 * be *shown* in. The two pieces of information serve different purposes and
 * neither replaces the other:
 *
 *   - the timestamp says when it happens, the same for everyone;
 *   - the tzid says how it is to be read on the clock of the place.
 *
 * An event at 09:00 in Tokyo stays "09:00" even for whoever looks at it from
 * Rome: showing it as "02:00" would be technically exact and practically
 * wrong. That is why the zone has to be kept and not derived from the
 * timestamp.
 */

export const timeEventSchema = calendarSharedSchema.extend({
  /** The starting instant, in unix seconds. */
  start: z.number().int().positive(),
  /** The ending instant, in unix seconds. Absent when the event declares no duration. */
  end: z.number().int().positive().optional(),
  /** The zone the event is to be shown in. */
  startTzid: z.string().optional(),
  endTzid: z.string().optional(),
  /** The daily indices the `D` tags declare. */
  days: z.array(z.number().int()),
})

export type TimeEventParsed = z.infer<typeof timeEventSchema>

export interface TimeEventInput extends CalendarSharedInput {
  start: number
  end?: number
  startTzid?: string
  endTzid?: string
}

export const calendarTimeEventDefinition = defineKind<TimeEventParsed, TimeEventInput>({
  kind: 31923,
  name: 'evento-calendario-orario',
  nip: 'NIP-52',
  class: 'addressable',
  editable: true, // addressable: republishing with the same `d` replaces
  deletable: true,
  schema: timeEventSchema,
  feed: { eligible: false },
  renderer: 'calendar-event',

  identifier: (input) => input.identifier,

  parse(event) {
    const numero = (nome: string): number | undefined => {
      const grezzo = tagValue(event, nome)
      if (grezzo === undefined) return undefined
      const n = Number.parseInt(grezzo, 10)
      return Number.isFinite(n) && n > 0 ? n : undefined
    }

    const start = numero('start')
    if (start === undefined) {
      throw new Error(`kind 31923 senza tag "start" valido: evento ${event.id}`)
    }
    const end = numero('end')
    const startTzid = tagValue(event, 'start_tzid')
    const endTzid = tagValue(event, 'end_tzid')

    const days = tagValues(event, 'D')
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => Number.isFinite(n))

    return timeEventSchema.parse({
      ...parseShared(event),
      start,
      ...(end !== undefined ? { end } : {}),
      ...(startTzid !== undefined ? { startTzid } : {}),
      ...(endTzid !== undefined ? { endTzid } : {}),
      // When the D tags are missing — an event written by a client older than
      // the revision that introduced them — they are derived from the instant,
      // so what is read is complete all the same.
      days: days.length > 0 ? days : [dayIndex(start)],
    })
  },

  build(input, ctx) {
    // NIP-52: «start ... Must be less than `end`, if it exists». The
    // comparison is strict: an end equal to the start would describe a
    // duration of zero, which is expressed by omitting `end` instead.
    if (input.end !== undefined && input.end <= input.start) {
      throw new Error(
        'La fine deve essere successiva all’inizio. Per un evento istantaneo ometti end.',
      )
    }
    for (const tz of [input.startTzid, input.endTzid]) {
      if (tz !== undefined) timezoneSchema.parse(tz)
    }

    return {
      kind: 31923,
      content: input.description ?? '',
      tags: [
        ...buildSharedTags(input),
        ['start', String(input.start)],
        ...(input.end !== undefined ? [['end', String(input.end)]] : []),
        // Required by NIP-52: one tag for every day the event covers.
        ...buildDayTags(input.start, input.end),
        ...optionalTag('start_tzid', input.startTzid),
        // The end zone is written only when it differs: repeating it the same
        // as the start's is noise every reader would then have to ignore.
        ...optionalTag(
          'end_tzid',
          input.endTzid && input.endTzid !== input.startTzid ? input.endTzid : undefined,
        ),
      ],
      created_at: ctx.now,
    }
  },
})
