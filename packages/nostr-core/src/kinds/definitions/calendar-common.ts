import { z } from 'zod'

import { optionalTag, repeatedTags, tagValue, tagValues, tagsNamed } from '../tags.js'
import type { NostrEvent } from '../types.js'

/**
 * The parts common to NIP-52's two calendar event kinds: 31922 (by date) and
 * 31923 (by time). Only how start and end are expressed changes.
 */

/** A participant in an event: pubkey, suggested relay and role. */
export const calendarParticipantSchema = z.object({
  pubkey: z.string(),
  /** The relay to find that profile on. An empty string when not stated. */
  relay: z.string().optional(),
  /** A free-form role: "speaker", "organizer", "host"… */
  role: z.string().optional(),
})

export type CalendarParticipant = z.infer<typeof calendarParticipantSchema>

/** The shared descriptive fields. */
export const calendarSharedSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  /** A free-form description: it sits in the `content`, not in a tag. */
  description: z.string(),
  summary: z.string().optional(),
  image: z.string().optional(),
  /**
   * The event's places. NIP-52 defines `location` as repeatable: a meeting can
   * have both a physical address and a link to the video call, and keeping
   * only one of them would lose information.
   */
  locations: z.array(z.string()),
  /** The place's geohash (the `g` tag). */
  geohash: z.string().optional(),
  participants: z.array(calendarParticipantSchema),
  /**
   * The hashtags (the `t` tag), **as they stand in the event**.
   *
   * They are neither lower-cased nor normalised here: another client writes
   * `Food & drink` as a category, and rewriting it `food & drink` — or worse,
   * splitting it — means changing somebody else's data in the mere act of
   * editing their title. The lower-case convention applies to what the user
   * writes in the form, with `normalizeHashtag`, where it originates.
   */
  hashtags: z.array(z.string()),
  /** External references, e.g. a link to the original event (the `r` tag). */
  references: z.array(z.string()),
  /** The coordinates of the calendars (kind 31924) it asks to appear in. */
  calendars: z.array(z.string()),
})

export type CalendarShared = z.infer<typeof calendarSharedSchema>

export interface CalendarSharedInput {
  /**
   * The `d` tag's value. Mandatory and the caller's responsibility on purpose:
   * generating it here would make it different on every call, and an edit
   * would end up creating a new event instead of replacing the previous one.
   * For a new event use `newCalendarIdentifier()`.
   */
  identifier: string
  title: string
  description?: string
  summary?: string
  image?: string
  /** One or more places. A single string remains the common case. */
  location?: string | string[]
  geohash?: string
  /** Plain pubkeys, or participants with a relay and a role. */
  participants?: (string | CalendarParticipant)[]
  hashtags?: string[]
  references?: string[]
  /** The `31924:<pubkey>:<d>` coordinates of the calendars to offer the event to. */
  calendars?: string[]
}

/** An identifier for a new calendar event. */
export function newCalendarIdentifier(): string {
  return crypto.randomUUID()
}

/** Normalises a participant written as a plain pubkey. */
function toParticipant(p: string | CalendarParticipant): CalendarParticipant {
  return typeof p === 'string' ? { pubkey: p } : p
}

/** Reads the common descriptive fields from the event. */
export function parseShared(event: NostrEvent): CalendarShared {
  const partecipanti: CalendarParticipant[] = tagsNamed(event, 'p')
    .filter((t) => typeof t[1] === 'string' && t[1].length > 0)
    .map((t) => ({
      pubkey: t[1] as string,
      // Positions 2 and 3 are the relay and the role. The relay is often an
      // empty string used as a placeholder to reach the role: discard it.
      ...(t[2] ? { relay: t[2] } : {}),
      ...(t[3] ? { role: t[3] } : {}),
    }))

  return {
    identifier: tagValue(event, 'd') ?? '',
    title: tagValue(event, 'title') ?? '',
    description: event.content,
    ...(tagValue(event, 'summary') !== undefined
      ? { summary: tagValue(event, 'summary') as string }
      : {}),
    ...(tagValue(event, 'image') !== undefined
      ? { image: tagValue(event, 'image') as string }
      : {}),
    locations: tagValues(event, 'location'),
    ...(tagValue(event, 'g') !== undefined ? { geohash: tagValue(event, 'g') as string } : {}),
    participants: partecipanti,
    hashtags: tagValues(event, 't'),
    references: tagValues(event, 'r'),
    calendars: tagValues(event, 'a'),
  }
}

/** Builds the common tags, except `d`, which depends on the calling kind. */
export function buildSharedTags(input: CalendarSharedInput): string[][] {
  const luoghi =
    input.location === undefined
      ? []
      : Array.isArray(input.location)
        ? input.location
        : [input.location]

  const partecipanti = (input.participants ?? []).map(toParticipant).flatMap((p) => {
    const pubkey = p.pubkey.trim()
    if (!pubkey) return []
    // The role sits in fourth position: reaching it requires the relay field
    // all the same, even empty. Without a role the tag stays short.
    if (p.role) return [['p', pubkey, p.relay ?? '', p.role]]
    if (p.relay) return [['p', pubkey, p.relay]]
    return [['p', pubkey]]
  })

  return [
    ['d', input.identifier],
    ['title', input.title],
    ...optionalTag('summary', input.summary),
    ...optionalTag('image', input.image),
    ...repeatedTags('location', luoghi),
    ...optionalTag('g', input.geohash),
    ...partecipanti,
    ...repeatedTags('t', input.hashtags ?? []),
    ...repeatedTags('r', input.references ?? []),
    ...repeatedTags('a', input.calendars ?? []),
  ]
}

// --- Time zones -------------------------------------------------------------

/**
 * The list of IANA time zones the runtime recognises.
 *
 * `Intl.supportedValuesOf` exists in Node 18+ and in modern browsers, but it
 * is not guaranteed everywhere: when it is missing an empty list is returned
 * and the validation falls back on `isValidTimezone`, which tries the zone
 * itself.
 */
export function availableTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/** The device's time zone, to use as the default in the forms. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Checks that a string is a usable IANA zone.
 *
 * A formatter is built as the test: it is the most reliable check, because it
 * uses the same implementation that will then format the dates.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const timezoneSchema = z.string().refine(isValidTimezone, {
  message: 'fuso orario IANA non riconosciuto (es. Europe/Rome)',
})

/**
 * A date in `YYYY-MM-DD` form, as kind 31922 wants it.
 *
 * The check is not only on the shape: that the date really exists is verified
 * too, otherwise "2026-02-30" would pass.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato atteso YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'data inesistente nel calendario')

// --- Converting between local time and an absolute instant ------------------

/**
 * The `tz` zone's offset from UTC, in seconds, at the given instant.
 *
 * There is no direct API: `Intl` is asked to format the instant in that zone
 * and the result is measured against UTC. It is the standard method, and it
 * uses the same zone database that will then format the dates.
 */
function offsetAt(unix: number, tz: string): number {
  const istante = new Date(unix * 1000)
  const parti = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(istante)

  const p: Record<string, number> = {}
  for (const parte of parti) {
    if (parte.type !== 'literal') p[parte.type] = Number.parseInt(parte.value, 10)
  }

  // Some locale combinations render midnight as "24": it has to be brought
  // back to 0, otherwise the offset comes out a day off.
  const ora = (p.hour ?? 0) % 24

  const comeUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    ora,
    p.minute ?? 0,
    p.second ?? 0,
  )
  return Math.round((comeUtc - istante.getTime()) / 1000)
}

/**
 * Converts a calendar time ("3 March at 09:00 in Tokyo") into the
 * corresponding absolute instant in unix seconds.
 *
 * Two passes are needed. The first estimates the offset by treating the time
 * as though it were UTC; but near a daylight-saving change the offset at the
 * correct instant can differ from the estimated one, so it is recomputed. With
 * a single pass you are an hour out on the transition days.
 *
 * @param isoDate the day, in `YYYY-MM-DD` form
 * @param time    the time, in `HH:MM` form
 * @param tz      the IANA zone, e.g. `Europe/Rome`
 */
export function zonedToUnix(isoDate: string, time: string, tz: string): number {
  const [anno, mese, giorno] = isoDate.split('-').map((n) => Number.parseInt(n, 10))
  const [ora, minuto] = time.split(':').map((n) => Number.parseInt(n, 10))

  if ([anno, mese, giorno, ora, minuto].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error(`Data od orario non validi: "${isoDate} ${time}"`)
  }

  const orarioComeUtc =
    Date.UTC(
      anno as number,
      (mese as number) - 1,
      giorno as number,
      ora as number,
      minuto as number,
    ) / 1000

  const stima = orarioComeUtc - offsetAt(orarioComeUtc, tz)
  return orarioComeUtc - offsetAt(stima, tz)
}

/**
 * Breaks an instant down into its calendar fields, read in the given zone.
 *
 * It is the inverse of `zonedToUnix` and it is what repopulates the forms when
 * an already published event is edited.
 */
export function unixToZoned(unix: number, tz: string): { date: string; time: string } {
  const parti = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(unix * 1000))

  const p: Record<string, string> = {}
  for (const parte of parti) {
    if (parte.type !== 'literal') p[parte.type] = parte.value
  }
  const ora = String(Number.parseInt(p.hour ?? '0', 10) % 24).padStart(2, '0')

  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${ora}:${p.minute}`,
  }
}

/** Formats an instant for reading, in the zone the event is to be shown in. */
export function formatInTimezone(unix: number, tz: string, locale = 'it-IT'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(unix * 1000))
}

// --- The D tag: the daily index (kind 31923 only) ----------------------------

/** Seconds in a day. */
const SECONDI_AL_GIORNO = 86_400

/**
 * The threshold beyond which a duration is almost certainly a unit mistake.
 *
 * NIP-52 has no recurrences: a single event spanning more than a year does not
 * exist in practice. The real case this threshold catches is a timestamp
 * passed in milliseconds instead of seconds, which makes a one-day event look
 * exactly 1000 days long. The threshold therefore has to stay below that value
 * to be of any use.
 */
const GIORNI_MASSIMI = 366

/**
 * The index of the day an instant falls on, as NIP-52 defines it:
 * `floor(unix_seconds / seconds_in_one_day)`.
 *
 * It is a purely arithmetic computation on the timestamp, hence **anchored to
 * UTC**: the event's zone does not enter into it. The consequence is
 * counter-intuitive but intended by the specification — an event at 23:00 in
 * Tokyo falls on the previous UTC day, and its `D` tag will be that one.
 * Bringing the zone in here would produce indices that do not match the ones
 * other clients compute, making the event invisible to their searches by day.
 */
export function dayIndex(unixSeconds: number): number {
  return Math.floor(unixSeconds / SECONDI_AL_GIORNO)
}

/**
 * Every daily index an event covers, both ends included.
 *
 * NIP-52 asks for several `D` tags to cover the whole duration: relays and
 * clients need them to find a given day's events without scanning the whole
 * archive. An event without an end takes up a single day.
 */
export function dayIndexRange(start: number, end?: number): number[] {
  const primo = dayIndex(start)
  if (end === undefined) return [primo]

  const ultimo = dayIndex(end)
  if (ultimo < primo) {
    throw new Error('La fine dell’evento precede l’inizio: impossibile calcolare i tag D.')
  }

  const quanti = ultimo - primo + 1
  if (quanti > GIORNI_MASSIMI) {
    throw new Error(
      `L’evento coprirebbe ${quanti} giorni, un valore implausibile. ` +
        'Controlla che start ed end siano in SECONDI e non in millisecondi.',
    )
  }

  return Array.from({ length: quanti }, (_, i) => primo + i)
}

/** The `D` tags to put in the event, one per day covered. */
export function buildDayTags(start: number, end?: number): string[][] {
  return dayIndexRange(start, end).map((g) => ['D', String(g)])
}
