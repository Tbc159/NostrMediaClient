import { z } from 'zod'

import { defineKind } from '../registry.js'
import { tagValue } from '../tags.js'
import {
  buildSharedTags,
  calendarSharedSchema,
  isoDateSchema,
  parseShared,
  type CalendarSharedInput,
} from './calendar-common.js'

/**
 * Kind 31922 — a whole-day calendar event (NIP-52).
 *
 * No time and no zone: it is the case of birthdays, public holidays, time off.
 * An event "on 3 March" is 3 March wherever you look at it from, and turning
 * it into an absolute instant would introduce exactly the error this kind
 * avoids.
 *
 * NIP-52 defines `end` as **exclusive**: a single-day event either omits `end`
 * or sets it to the next day. An `end` equal to `start` would describe an event
 * of zero length.
 *
 * A note on the `D` tag: the specification requires it **for kind 31923
 * only**, where it serves to index an absolute instant by day. Here it has no
 * reason to exist, because `start` and `end` are calendar dates already:
 * adding it would mean reintroducing precisely the anchoring to UTC this kind
 * avoids. The 31922 section indeed lists only `start` and `end`, and its JSON
 * example contains no `D` at all.
 */

export const dateEventSchema = calendarSharedSchema.extend({
  /** The starting day, `YYYY-MM-DD`. */
  start: isoDateSchema,
  /** The ending day, exclusive. */
  end: isoDateSchema.optional(),
})

export type DateEventParsed = z.infer<typeof dateEventSchema>

export interface DateEventInput extends CalendarSharedInput {
  start: string
  end?: string
}

export const calendarDateEventDefinition = defineKind<DateEventParsed, DateEventInput>({
  kind: 31922,
  name: 'evento-calendario-data',
  nip: 'NIP-52',
  class: 'addressable',
  editable: true,
  deletable: true,
  schema: dateEventSchema,
  feed: { eligible: false },
  renderer: 'calendar-event',

  identifier: (input) => input.identifier,

  parse(event) {
    const start = tagValue(event, 'start')
    if (start === undefined) {
      throw new Error(`kind 31922 senza tag "start": evento ${event.id}`)
    }
    const end = tagValue(event, 'end')

    return dateEventSchema.parse({
      ...parseShared(event),
      start,
      ...(end !== undefined ? { end } : {}),
    })
  },

  build(input, ctx) {
    isoDateSchema.parse(input.start)
    if (input.end !== undefined) {
      isoDateSchema.parse(input.end)
      if (input.end <= input.start) {
        // A lexicographic comparison: on YYYY-MM-DD it equals the chronological one.
        throw new Error(
          `end (${input.end}) deve essere successivo a start (${input.start}): ` +
            'NIP-52 lo definisce esclusivo, quindi un evento di un giorno solo omette end ' +
            'oppure lo pone al giorno dopo',
        )
      }
    }

    return {
      kind: 31922,
      content: input.description ?? '',
      tags: [
        ...buildSharedTags(input),
        ['start', input.start],
        ...(input.end !== undefined ? [['end', input.end]] : []),
      ],
      created_at: ctx.now,
    }
  },
})
