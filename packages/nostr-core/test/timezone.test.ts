import { describe, expect, it } from 'vitest'

import {
  formatInTimezone,
  isValidTimezone,
  unixToZoned,
  zonedToUnix,
} from '../src/kinds/definitions/calendar-common.js'

describe('zonedToUnix', () => {
  it('interpreta lo stesso orario di calendario in modo diverso a seconda del fuso', () => {
    // "le 09:00 del 1 settembre" e' un istante diverso a Tokyo e a Roma.
    const tokyo = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    const roma = zonedToUnix('2026-09-01', '09:00', 'Europe/Rome')
    const utc = zonedToUnix('2026-09-01', '09:00', 'UTC')

    expect(tokyo).toBe(utc - 9 * 3600) // Tokyo e' avanti: l'istante arriva prima
    expect(roma).toBe(utc - 2 * 3600) // Roma d'estate e' UTC+2
    expect(tokyo).toBeLessThan(roma)
  })

  it('gestisce il passaggio all ora legale senza sbagliare di un ora', () => {
    // In Italia l'ora legale 2026 finisce il 25 ottobre alle 03:00 locali.
    // Il giorno prima si e' ancora a UTC+2, il giorno dopo a UTC+1: e' il caso
    // in cui una stima a passaggio singolo sbaglia.
    const prima = zonedToUnix('2026-10-24', '12:00', 'Europe/Rome')
    const dopo = zonedToUnix('2026-10-26', '12:00', 'Europe/Rome')

    expect(prima).toBe(Date.UTC(2026, 9, 24, 10, 0) / 1000) // UTC+2
    expect(dopo).toBe(Date.UTC(2026, 9, 26, 11, 0) / 1000) // UTC+1
  })

  it('gestisce anche il passaggio inverso, in primavera', () => {
    // L'ora legale 2026 inizia il 29 marzo.
    const prima = zonedToUnix('2026-03-28', '12:00', 'Europe/Rome')
    const dopo = zonedToUnix('2026-03-30', '12:00', 'Europe/Rome')
    expect(prima).toBe(Date.UTC(2026, 2, 28, 11, 0) / 1000) // UTC+1
    expect(dopo).toBe(Date.UTC(2026, 2, 30, 10, 0) / 1000) // UTC+2
  })

  it('gestisce la mezzanotte, dove alcuni locale rendono l ora come 24', () => {
    const t = zonedToUnix('2026-09-01', '00:00', 'Europe/Rome')
    expect(unixToZoned(t, 'Europe/Rome')).toEqual({ date: '2026-09-01', time: '00:00' })
  })

  it('gestisce i fusi con offset non intero', () => {
    // Kathmandu e' UTC+5:45.
    const utc = zonedToUnix('2026-09-01', '12:00', 'UTC')
    const ktm = zonedToUnix('2026-09-01', '12:00', 'Asia/Kathmandu')
    expect(utc - ktm).toBe(5 * 3600 + 45 * 60)
  })

  it('rifiuta input malformati', () => {
    expect(() => zonedToUnix('non-una-data', '09:00', 'UTC')).toThrow()
    expect(() => zonedToUnix('2026-09-01', 'boh', 'UTC')).toThrow()
  })
})

describe('unixToZoned', () => {
  it('e la funzione inversa di zonedToUnix', () => {
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

  it('mostra lo stesso istante con orari diversi in fusi diversi', () => {
    // La proprieta' che giustifica di conservare start_tzid accanto a start:
    // un evento "alle 09:00 a Tokyo" non e' "alle 09:00" per chi sta a Roma.
    const istante = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    expect(unixToZoned(istante, 'Asia/Tokyo').time).toBe('09:00')
    expect(unixToZoned(istante, 'Europe/Rome').time).toBe('02:00')
  })
})

describe('isValidTimezone', () => {
  it('riconosce i fusi IANA e scarta il resto', () => {
    expect(isValidTimezone('Europe/Rome')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Marte/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})

describe('formatInTimezone', () => {
  it('formatta nel fuso richiesto, non in quello del sistema', () => {
    const istante = zonedToUnix('2026-09-01', '09:00', 'Asia/Tokyo')
    expect(formatInTimezone(istante, 'Asia/Tokyo')).toContain('09:00')
  })
})
