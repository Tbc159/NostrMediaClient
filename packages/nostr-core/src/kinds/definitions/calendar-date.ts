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
 * Kind 31922 — evento calendario su data intera (NIP-52).
 *
 * Niente orario e niente fuso: e' il caso di compleanni, festivita', ferie.
 * Un evento "il 3 marzo" e' il 3 marzo ovunque lo si guardi, e trasformarlo in
 * un istante assoluto introdurrebbe proprio l'errore che questo kind evita.
 *
 * NIP-52 definisce `end` come **esclusivo**: un evento di un solo giorno o
 * omette `end`, oppure lo mette al giorno successivo. Un `end` uguale a `start`
 * descriverebbe un evento di durata nulla.
 *
 * Nota sul tag `D`: la specifica lo richiede **solo per il kind 31923**, dove
 * serve a indicizzare per giorno un istante assoluto. Qui non ha ragione di
 * esistere, perche' `start` ed `end` sono gia' date di calendario: aggiungerlo
 * significherebbe reintrodurre proprio l'ancoraggio a UTC che questo kind
 * evita. La sezione del 31922 elenca infatti soltanto `start` ed `end`, e il
 * suo esempio JSON non contiene alcun `D`.
 */

export const dateEventSchema = calendarSharedSchema.extend({
  /** Giorno di inizio, `YYYY-MM-DD`. */
  start: isoDateSchema,
  /** Giorno di fine, esclusivo. */
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
        // Confronto lessicografico: su YYYY-MM-DD equivale a quello cronologico.
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
