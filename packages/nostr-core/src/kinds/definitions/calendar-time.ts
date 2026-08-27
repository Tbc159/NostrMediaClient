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
 * Kind 31923 — evento calendario con orario (NIP-52).
 *
 * Il punto delicato di tutto il NIP sta qui. `start` e' un timestamp unix,
 * quindi un istante assoluto, ma `start_tzid` dice in quale fuso l'evento va
 * *mostrato*. Le due informazioni servono a scopi diversi e nessuna sostituisce
 * l'altra:
 *
 *   - il timestamp dice quando accade, uguale per tutti;
 *   - il tzid dice come va letto sull'orologio del luogo.
 *
 * Un evento alle 09:00 a Tokyo resta "le 09:00" anche per chi lo guarda da
 * Roma: mostrarlo come "le 02:00" sarebbe tecnicamente esatto e praticamente
 * sbagliato. Per questo il fuso va conservato e non ricavato dal timestamp.
 */

export const timeEventSchema = calendarSharedSchema.extend({
  /** Istante di inizio, secondi unix. */
  start: z.number().int().positive(),
  /** Istante di fine, secondi unix. Assente se l'evento non ha durata dichiarata. */
  end: z.number().int().positive().optional(),
  /** Fuso in cui l'evento va mostrato. */
  startTzid: z.string().optional(),
  endTzid: z.string().optional(),
  /** Indici giornalieri dichiarati dai tag `D`. */
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
  editable: true, // addressable: ripubblicare con lo stesso `d` sostituisce
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
      // Se i tag D mancano — evento scritto da un client piu' vecchio della
      // revisione che li ha introdotti — si ricavano dall'istante, cosi' il
      // dato letto e' comunque completo.
      days: days.length > 0 ? days : [dayIndex(start)],
    })
  },

  build(input, ctx) {
    // NIP-52: «start ... Must be less than `end`, if it exists». Il confronto
    // e' stretto: una fine uguale all'inizio descriverebbe una durata nulla,
    // che si esprime invece omettendo `end`.
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
        // Richiesto da NIP-52: un tag per ogni giorno coperto dall'evento.
        ...buildDayTags(input.start, input.end),
        ...optionalTag('start_tzid', input.startTzid),
        // Il fuso di fine si scrive solo se diverso: ripeterlo uguale a quello
        // di inizio e' rumore che ogni lettore dovrebbe poi ignorare.
        ...optionalTag(
          'end_tzid',
          input.endTzid && input.endTzid !== input.startTzid ? input.endTzid : undefined,
        ),
      ],
      created_at: ctx.now,
    }
  },
})
