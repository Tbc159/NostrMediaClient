import { z } from 'zod'

import { optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'
import { normalizeHashtag } from '../tags.js'
import type { NostrEvent } from '../types.js'

/**
 * Parti comuni ai due kind di evento calendario NIP-52: 31922 (su data) e
 * 31923 (su orario). Cambia solo come si esprimono inizio e fine.
 */

/** Campi descrittivi condivisi. */
export const calendarSharedSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  /** Descrizione libera: sta nel `content`, non in un tag. */
  description: z.string(),
  summary: z.string().optional(),
  image: z.string().optional(),
  location: z.string().optional(),
  /** Geohash del luogo (tag `g`). */
  geohash: z.string().optional(),
  /** Pubkey dei partecipanti (tag `p`). */
  participants: z.array(z.string()),
  hashtags: z.array(z.string()),
  /** Riferimenti esterni, es. link all'evento originale (tag `r`). */
  references: z.array(z.string()),
})

export type CalendarShared = z.infer<typeof calendarSharedSchema>

export interface CalendarSharedInput {
  /**
   * Valore del tag `d`. Obbligatorio e a carico del chiamante di proposito:
   * generarlo qui lo renderebbe diverso a ogni chiamata, e una modifica
   * finirebbe per creare un evento nuovo invece di sostituire il precedente.
   * Per un evento nuovo usare `newCalendarIdentifier()`.
   */
  identifier: string
  title: string
  description?: string
  summary?: string
  image?: string
  location?: string
  geohash?: string
  participants?: string[]
  hashtags?: string[]
  references?: string[]
}

/** Identificatore per un evento calendario nuovo. */
export function newCalendarIdentifier(): string {
  return crypto.randomUUID()
}

/** Legge dall'evento i campi descrittivi comuni. */
export function parseShared(event: NostrEvent): CalendarShared {
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
    ...(tagValue(event, 'location') !== undefined
      ? { location: tagValue(event, 'location') as string }
      : {}),
    ...(tagValue(event, 'g') !== undefined ? { geohash: tagValue(event, 'g') as string } : {}),
    participants: tagValues(event, 'p'),
    hashtags: tagValues(event, 't').map(normalizeHashtag),
    references: tagValues(event, 'r'),
  }
}

/** Costruisce i tag comuni, escluso `d` che dipende dal kind chiamante. */
export function buildSharedTags(input: CalendarSharedInput): string[][] {
  return [
    ['d', input.identifier],
    ['title', input.title],
    ...optionalTag('summary', input.summary),
    ...optionalTag('image', input.image),
    ...optionalTag('location', input.location),
    ...optionalTag('g', input.geohash),
    ...repeatedTags('p', input.participants ?? []),
    ...repeatedTags('t', (input.hashtags ?? []).map(normalizeHashtag)),
    ...repeatedTags('r', input.references ?? []),
  ]
}

// --- Fusi orari -------------------------------------------------------------

/**
 * Elenco dei fusi orari IANA riconosciuti dal runtime.
 *
 * `Intl.supportedValuesOf` esiste in Node 18+ e nei browser moderni, ma non e'
 * garantito ovunque: se manca si restituisce una lista vuota e la validazione
 * ricade su `isValidTimezone`, che prova direttamente il fuso.
 */
export function availableTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/** Fuso orario del dispositivo, da usare come default nei form. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Verifica che una stringa sia un fuso IANA utilizzabile.
 *
 * Si prova a costruire un formatter: e' il controllo piu' affidabile, perche'
 * usa la stessa implementazione che poi formattera' le date.
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
 * Data in formato `YYYY-MM-DD`, come la vuole il kind 31922.
 *
 * Il controllo non e' solo sulla forma: si verifica che la data esista davvero,
 * altrimenti "2026-02-30" passerebbe.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato atteso YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'data inesistente nel calendario')

// --- Conversione fra orario locale e istante assoluto -----------------------

/**
 * Offset del fuso `tz` rispetto a UTC, in secondi, all'istante indicato.
 *
 * Non esiste un'API diretta: si chiede a `Intl` di formattare l'istante in quel
 * fuso e si misura di quanto il risultato si discosta da UTC. E' il metodo
 * standard, e usa lo stesso database dei fusi che poi formattera' le date.
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

  // Alcune combinazioni di locale rendono la mezzanotte come "24": va
  // riportata a 0, altrimenti l'offset risulta sfalsato di un giorno.
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
 * Converte un orario da calendario ("il 3 marzo alle 09:00 a Tokyo") nel
 * corrispondente istante assoluto in secondi unix.
 *
 * Servono due passaggi. Il primo stima l'offset trattando l'orario come se
 * fosse UTC; ma vicino a un cambio di ora legale l'offset all'istante corretto
 * puo' differire da quello stimato, quindi si ricalcola. Con un solo passaggio
 * si sbaglia di un'ora nei giorni di transizione.
 *
 * @param isoDate giorno in formato `YYYY-MM-DD`
 * @param time    orario in formato `HH:MM`
 * @param tz      fuso IANA, es. `Europe/Rome`
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
 * Scompone un istante nei suoi campi di calendario, letti nel fuso indicato.
 *
 * E' l'inverso di `zonedToUnix` e serve a ripopolare i form quando si modifica
 * un evento gia' pubblicato.
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

/** Formatta un istante per la lettura, nel fuso in cui l'evento va mostrato. */
export function formatInTimezone(unix: number, tz: string, locale = 'it-IT'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(unix * 1000))
}
