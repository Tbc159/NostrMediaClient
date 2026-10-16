import { describe, expect, it } from 'vitest'

import {
  formatInTimezone,
  isValidTimezone,
  unixToZoned,
  zonedToUnix,
} from '../src/kinds/definitions/calendar-common.js'

describe('zonedToUnix', () => {
  it('reads the same calendar time differently depending on the zone', () => {
    // "09:00 on 1 September" is a different instant in Tokyo and in Rome.
    const tokyo = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    const roma = zonedToUnix('2026-09-01', '09:00', 'Europe/Rome')
    const utc = zonedToUnix('2026-09-01', '09:00', 'UTC')

    expect(tokyo).toBe(utc - 9 * 3600) // Tokyo e' avanti: l'istante arriva prima
    expect(roma).toBe(utc - 2 * 3600) // Roma d'estate e' UTC+2
    expect(tokyo).toBeLessThan(roma)
  })

  it('handles the switch to summer time without being an hour out', () => {
    // In Italy summer time in 2026 ends on 25 October at 03:00 local. The day
    // before you are still at UTC+2, the day after at UTC+1: it is the case a
    // single-pass estimate gets wrong.
    const prima = zonedToUnix('2026-10-24', '12:00', 'Europe/Rome')
    const dopo = zonedToUnix('2026-10-26', '12:00', 'Europe/Rome')

    expect(prima).toBe(Date.UTC(2026, 9, 24, 10, 0) / 1000) // UTC+2
    expect(dopo).toBe(Date.UTC(2026, 9, 26, 11, 0) / 1000) // UTC+1
  })

  it('handles the reverse switch too, in spring', () => {
    // Summer time in 2026 starts on 29 March.
    const prima = zonedToUnix('2026-03-28', '12:00', 'Europe/Rome')
    const dopo = zonedToUnix('2026-03-30', '12:00', 'Europe/Rome')
    expect(prima).toBe(Date.UTC(2026, 2, 28, 11, 0) / 1000) // UTC+1
    expect(dopo).toBe(Date.UTC(2026, 2, 30, 10, 0) / 1000) // UTC+2
  })

  it('handles midnight, where some locales render the hour as 24', () => {
    const t = zonedToUnix('2026-09-01', '00:00', 'Europe/Rome')
    expect(unixToZoned(t, 'Europe/Rome')).toEqual({ date: '2026-09-01', time: '00:00' })
  })

  it('handles the zones with a non-integer offset', () => {
    // Kathmandu is UTC+5:45.
    const utc = zonedToUnix('2026-09-01', '12:00', 'UTC')
    const ktm = zonedToUnix('2026-09-01', '12:00', 'Asia/Kathmandu')
    expect(utc - ktm).toBe(5 * 3600 + 45 * 60)
  })

  it('refuses malformed input', () => {
    expect(() => zonedToUnix('non-una-data', '09:00', 'UTC')).toThrow()
    expect(() => zonedToUnix('2026-09-01', 'boh', 'UTC')).toThrow()
  })
})

describe('unixToZoned', () => {
  it('is the inverse of zonedToUnix', () => {
    for (const tz of ['Europe/Rome', 'Asia/Tokyo', 'America/New_York', 'Asia/Kathmandu']) {
      for (const [d, t] of [
        ['2026-01-15', '08:30'],
        ['2026-07-04', '23:45'],
        ['2026-10-25', '14:00'],
      ] as const) {
        expect(unixToZoned(zonedToUnix(d, t, tz), tz)).toEqual({ date: d, time: t })
      }
    }
  })

  it('shows the same instant at different times in different zones', () => {
    // The property that justifies keeping start_tzid next to start: an event
    // "at 09:00 in Tokyo" is not "at 09:00" for whoever is in Rome.
    const istante = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    expect(unixToZoned(istante, 'Asia/Tokyo').time).toBe('09:00')
    expect(unixToZoned(istante, 'Europe/Rome').time).toBe('02:00')
  })
})

describe('isValidTimezone', () => {
  it('recognises the IANA zones and discards the rest', () => {
    expect(isValidTimezone('Europe/Rome')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Marte/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})

describe('formatInTimezone', () => {
  it("formats in the requested zone, not the system's", () => {
    const istante = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    expect(formatInTimezone(istante, 'Asia/Tokyo')).toContain('09:00')
  })
})
