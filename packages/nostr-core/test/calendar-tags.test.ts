import { describe, expect, it } from 'vitest'

import { buildDayTags, dayIndex, dayIndexRange } from '../src/kinds/definitions/calendar-common.js'
import { calendarDateEventDefinition } from '../src/kinds/definitions/calendar-date.js'
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import type { NostrEvent } from '../src/kinds/types.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }
const tagsCon = (tags: string[][], nome: string): string[][] => tags.filter((t) => t[0] === nome)
const valori = (tags: string[][], nome: string): (string | undefined)[] =>
  tagsCon(tags, nome).map((t) => t[1])

function evento(p: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: CTX.pubkey,
    created_at: CTX.now,
    kind: 31923,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

describe('the daily index (the D tag)', () => {
  it("applies the specification's formula: floor(seconds / 86400)", () => {
    expect(dayIndex(0)).toBe(0)
    expect(dayIndex(86_399)).toBe(0)
    expect(dayIndex(86_400)).toBe(1)
    // The value from the example in the specification.
    expect(dayIndex(82_549 * 86_400)).toBe(82_549)
  })

  it("is anchored to UTC and not to the event's zone", () => {
    // A consequence the specification intends, computing the index from the
    // timestamp alone: an evening event in Tokyo falls on the previous UTC
    // day. Bringing the zone in here would produce indices incompatible with
    // the other clients'.
    const seraTokyo = Date.UTC(2026, 8, 1, 14, 0) / 1000 // 23:00 a Tokyo
    expect(dayIndex(seraTokyo)).toBe(dayIndex(Date.UTC(2026, 8, 1, 0, 0) / 1000))
  })

  it('covers a single day when the event has no end', () => {
    expect(dayIndexRange(Date.UTC(2026, 8, 1, 10, 0) / 1000)).toHaveLength(1)
  })

  it('covers every day in between, both ends included', () => {
    const inizio = Date.UTC(2026, 8, 1, 22, 0) / 1000
    const fine = Date.UTC(2026, 8, 4, 3, 0) / 1000
    const giorni = dayIndexRange(inizio, fine)
    expect(giorni).toHaveLength(4)
    expect(giorni[0]).toBe(dayIndex(inizio))
    expect(giorni[giorni.length - 1]).toBe(dayIndex(fine))
    // Consecutive, with no gaps.
    expect(giorni.every((g, i) => i === 0 || g === (giorni[i - 1] as number) + 1)).toBe(true)
  })

  it('catches the timestamps passed in milliseconds by mistake', () => {
    // The real case: with milliseconds the duration comes out a thousand
    // times too large and millions of tags would be generated.
    const inizioMs = Date.UTC(2026, 8, 1) // millisecondi, non secondi
    const fineMs = Date.UTC(2026, 8, 2)
    expect(() => dayIndexRange(inizioMs, fineMs)).toThrow(/millisecondi/)
  })

  it('refuses an end earlier than the start', () => {
    expect(() => dayIndexRange(1_800_000_000, 1_700_000_000)).toThrow(/precede/)
  })

  it('produces tags in the expected form', () => {
    expect(buildDayTags(82_549 * 86_400)).toEqual([['D', '82549']])
  })
})

describe('kind 31923 — the D tags in the event', () => {
  const base = { identifier: 'x', title: 'Riunione', start: Date.UTC(2026, 8, 1, 9, 0) / 1000 }

  it('includes the D tag, which the specification makes mandatory', () => {
    const t = calendarTimeEventDefinition.build(base, CTX)
    expect(tagsCon(t.tags, 'D')).toHaveLength(1)
    expect(valori(t.tags, 'D')[0]).toBe(String(dayIndex(base.start)))
  })

  it('includes one D tag per day covered by a long event', () => {
    const t = calendarTimeEventDefinition.build({ ...base, end: base.start + 3 * 86_400 }, CTX)
    expect(tagsCon(t.tags, 'D')).toHaveLength(4)
  })

  it('reads back the D tags present in the event', () => {
    const t = calendarTimeEventDefinition.build({ ...base, end: base.start + 86_400 }, CTX)
    const parsed = calendarTimeEventDefinition.parse(evento({ tags: t.tags }))
    expect(parsed.days).toEqual([dayIndex(base.start), dayIndex(base.start) + 1])
  })

  it('derives the days from the instant when the D tags are missing', () => {
    // Events written before the specification introduced the tag: what is
    // read stays complete instead of coming out empty.
    const parsed = calendarTimeEventDefinition.parse(
      evento({
        tags: [
          ['d', 'x'],
          ['title', 'T'],
          ['start', String(base.start)],
        ],
      }),
    )
    expect(parsed.days).toEqual([dayIndex(base.start)])
  })
})

describe('kind 31922 — no D tag', () => {
  it('writes no D tag: the specification does not provide for one on date events', () => {
    const t = calendarDateEventDefinition.build(
      { identifier: 'x', title: 'Ferie', start: '2026-08-01', end: '2026-08-08' },
      CTX,
    )
    expect(tagsCon(t.tags, 'D')).toHaveLength(0)
  })
})

describe('the shared tags reviewed against the specification', () => {
  const base = { identifier: 'x', title: 'T', start: '2026-08-01' }

  it('writes several location tags, because the specification makes it repeatable', () => {
    // A meeting can have both an address and a link to the video call.
    const t = calendarDateEventDefinition.build(
      { ...base, location: ['Via Roma 1, Milano', 'https://meet.example/abc'] },
      CTX,
    )
    expect(valori(t.tags, 'location')).toEqual(['Via Roma 1, Milano', 'https://meet.example/abc'])
  })

  it('still accepts a single place as a string', () => {
    const t = calendarDateEventDefinition.build({ ...base, location: 'Milano' }, CTX)
    expect(valori(t.tags, 'location')).toEqual(['Milano'])
  })

  it("writes the participants' relay and role in the expected positions", () => {
    const pk = 'cc'.repeat(32)
    const t = calendarDateEventDefinition.build(
      {
        ...base,
        participants: [
          pk,
          { pubkey: 'dd'.repeat(32), role: 'speaker' },
          { pubkey: 'ee'.repeat(32), relay: 'wss://relay.example', role: 'host' },
        ],
      },
      CTX,
    )
    const p = tagsCon(t.tags, 'p')
    expect(p[0]).toEqual(['p', pk])
    // The role sits in fourth position: the relay field is needed, even empty.
    expect(p[1]).toEqual(['p', 'dd'.repeat(32), '', 'speaker'])
    expect(p[2]).toEqual(['p', 'ee'.repeat(32), 'wss://relay.example', 'host'])
  })

  it("reads back the participants' relay and role", () => {
    const parsed = calendarDateEventDefinition.parse(
      evento({
        kind: 31922,
        tags: [
          ['d', 'x'],
          ['title', 'T'],
          ['start', '2026-08-01'],
          ['p', 'dd'.repeat(32), '', 'speaker'],
          ['p', 'ee'.repeat(32)],
        ],
      }),
    )
    expect(parsed.participants).toEqual([
      { pubkey: 'dd'.repeat(32), role: 'speaker' },
      { pubkey: 'ee'.repeat(32) },
    ])
  })

  it('writes the a tags towards the calendars to offer the event to', () => {
    const coord = `31924:${CTX.pubkey}:mio-calendario`
    const t = calendarDateEventDefinition.build({ ...base, calendars: [coord] }, CTX)
    expect(valori(t.tags, 'a')).toEqual([coord])
  })
})
