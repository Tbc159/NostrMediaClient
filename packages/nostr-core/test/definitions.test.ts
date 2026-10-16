import { describe, expect, it } from 'vitest'

import { calendarDateEventDefinition } from '../src/kinds/definitions/calendar-date.js'
import { calendarRsvpDefinition } from '../src/kinds/definitions/calendar-rsvp.js'
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { metadataDefinition } from '../src/kinds/definitions/metadata.js'
import { noteDefinition } from '../src/kinds/definitions/note.js'
import { normalizeHashtag } from '../src/kinds/tags.js'
import type { NostrEvent } from '../src/kinds/types.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

/** A minimal event for the parsing tests. */
function evento(parziale: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: CTX.pubkey,
    created_at: CTX.now,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...parziale,
  } as NostrEvent
}

/** The value of the first tag with that name in the built template. */
const tag = (tags: string[][], nome: string): string | undefined =>
  tags.find((t) => t[0] === nome)?.[1]

describe('kind 1 — a note', () => {
  it('marks the root and the parent when replying inside a thread', () => {
    const t = noteDefinition.build(
      {
        content: 'ci sto',
        replyTo: { id: 'bb'.repeat(32), pubkey: 'cc'.repeat(32), rootId: 'aa'.repeat(32) },
      },
      CTX,
    )
    const eTags = t.tags.filter((x) => x[0] === 'e')
    expect(eTags).toEqual([
      ['e', 'aa'.repeat(32), '', 'root'],
      ['e', 'bb'.repeat(32), '', 'reply'],
    ])
  })

  it('uses a single root-marked tag when replying to the root directly', () => {
    const t = noteDefinition.build(
      { content: 'ok', replyTo: { id: 'aa'.repeat(32), pubkey: 'cc'.repeat(32) } },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'e')).toEqual([['e', 'aa'.repeat(32), '', 'root']])
  })

  it("carries the thread's authors without duplicating them", () => {
    const autore = 'cc'.repeat(32)
    const t = noteDefinition.build(
      {
        content: 'x',
        replyTo: { id: 'bb'.repeat(32), pubkey: autore, participants: [autore, 'dd'.repeat(32)] },
        mentions: [autore],
      },
      CTX,
    )
    const p = t.tags.filter((x) => x[0] === 'p').map((x) => x[1])
    expect(p).toEqual([autore, 'dd'.repeat(32)])
  })

  it('writes the hashtags as it receives them, without rewriting them', () => {
    // The lower-case convention lives in `normalizeHashtag`, which the form
    // applies to what the user writes. Not here: a hashtag can arrive from
    // another client's event — «Food & drink» — and lower-casing it would mean
    // changing their data while correcting their title.
    const t = noteDefinition.build({ content: 'x', hashtags: ['#Nostr', 'Food & drink'] }, CTX)
    expect(t.tags.filter((x) => x[0] === 't')).toEqual([
      ['t', '#Nostr'],
      ['t', 'Food & drink'],
    ])
    expect(normalizeHashtag('#Nostr')).toBe('nostr')
  })

  it('reads the old threads with unmarked e tags', () => {
    // The pre-marker convention: the first `e` = the root, the last = the direct reply.
    const parsed = noteDefinition.parse(
      evento({
        content: 'vecchio',
        tags: [
          ['e', 'aa'.repeat(32)],
          ['e', 'bb'.repeat(32)],
          ['e', 'cc'.repeat(32)],
        ],
      }),
    )
    expect(parsed.rootId).toBe('aa'.repeat(32))
    expect(parsed.replyToId).toBe('cc'.repeat(32))
  })

  it('is not editable: the protocol does not allow it', () => {
    expect(noteDefinition.editable).toBe(false)
  })
})

describe('kind 31922 — an event on a date', () => {
  const base = { identifier: 'id-1', title: 'Ferie', start: '2026-08-01' }

  it('accepts an end later than the start', () => {
    const t = calendarDateEventDefinition.build({ ...base, end: '2026-08-08' }, CTX)
    expect(tag(t.tags, 'end')).toBe('2026-08-08')
  })

  it('refuses an end equal to the start, because NIP-52 defines it exclusive', () => {
    // A single-day event either omits end or sets it to the next day: an end
    // equal to the start would describe a duration of zero.
    expect(() => calendarDateEventDefinition.build({ ...base, end: '2026-08-01' }, CTX)).toThrow(
      /esclusivo/,
    )
  })

  it('refuses a date that does not exist in the calendar', () => {
    expect(() => calendarDateEventDefinition.build({ ...base, start: '2026-02-30' }, CTX)).toThrow()
  })

  it('writes no empty tags for the optional fields left unset', () => {
    const t = calendarDateEventDefinition.build(base, CTX)
    const nomi = t.tags.map((x) => x[0])
    expect(nomi).not.toContain('location')
    expect(nomi).not.toContain('image')
    expect(nomi).not.toContain('summary')
  })
})

describe('kind 31923 — an event with a time', () => {
  const base = {
    identifier: 'id-2',
    title: 'Riunione',
    start: 1_800_000_000,
    startTzid: 'Asia/Tokyo',
  }

  it('keeps the time zone next to the timestamp', () => {
    // The timestamp says when it happens, the tzid how it is to be shown:
    // both are needed, and the zone cannot be derived from the instant.
    const t = calendarTimeEventDefinition.build(base, CTX)
    expect(tag(t.tags, 'start')).toBe('1800000000')
    expect(tag(t.tags, 'start_tzid')).toBe('Asia/Tokyo')
  })

  it("omits end_tzid when it is the same as the start's", () => {
    const t = calendarTimeEventDefinition.build(
      { ...base, end: base.start + 3600, endTzid: 'Asia/Tokyo' },
      CTX,
    )
    expect(tag(t.tags, 'end_tzid')).toBeUndefined()
  })

  it('writes end_tzid when the event changes zone', () => {
    const t = calendarTimeEventDefinition.build(
      { ...base, end: base.start + 36000, endTzid: 'Europe/Rome' },
      CTX,
    )
    expect(tag(t.tags, 'end_tzid')).toBe('Europe/Rome')
  })

  it('requires an end strictly later than the start', () => {
    // NIP-52: «start ... Must be less than end, if it exists». An end equal to
    // the start would describe a duration of zero, expressed by omitting end.
    expect(() => calendarTimeEventDefinition.build({ ...base, end: base.start - 1 }, CTX)).toThrow(
      /successiva/,
    )
    expect(() => calendarTimeEventDefinition.build({ ...base, end: base.start }, CTX)).toThrow(
      /successiva/,
    )
  })

  it('refuses an invented time zone', () => {
    expect(() =>
      calendarTimeEventDefinition.build({ ...base, startTzid: 'Marte/Olympus' }, CTX),
    ).toThrow()
  })

  it('refuses to read an event without a start', () => {
    expect(() =>
      calendarTimeEventDefinition.parse(evento({ kind: 31923, tags: [['d', 'x']] })),
    ).toThrow(/senza tag "start"/)
  })

  it('survives a build → parse round trip keeping the zone', () => {
    const t = calendarTimeEventDefinition.build({ ...base, end: base.start + 3600 }, CTX)
    const parsed = calendarTimeEventDefinition.parse(
      evento({ kind: 31923, tags: t.tags, content: t.content }),
    )
    expect(parsed.start).toBe(base.start)
    expect(parsed.startTzid).toBe('Asia/Tokyo')
    expect(parsed.title).toBe('Riunione')
  })
})

describe('kind 31925 — RSVP', () => {
  const base = {
    identifier: 'r-1',
    eventAddress: `31923:${CTX.pubkey}:id-2`,
    status: 'accepted' as const,
  }

  it("points at the event's coordinate, not at its id", () => {
    // Calendar events are addressable: tying the RSVP to the id would hook it
    // to a version the organiser can replace.
    const t = calendarRsvpDefinition.build(base, CTX)
    expect(tag(t.tags, 'a')).toBe(`31923:${CTX.pubkey}:id-2`)
  })

  it('discards the availability on a refusal', () => {
    const t = calendarRsvpDefinition.build({ ...base, status: 'declined', freebusy: 'free' }, CTX)
    expect(tag(t.tags, 'fb')).toBeUndefined()
    expect(tag(t.tags, 'status')).toBe('declined')
  })

  it('keeps the availability on an acceptance', () => {
    const t = calendarRsvpDefinition.build({ ...base, freebusy: 'busy' }, CTX)
    expect(tag(t.tags, 'fb')).toBe('busy')
  })

  it('refuses to read an RSVP with no reference to the event', () => {
    expect(() =>
      calendarRsvpDefinition.parse(
        evento({
          kind: 31925,
          tags: [
            ['d', 'r'],
            ['status', 'accepted'],
          ],
        }),
      ),
    ).toThrow(/senza tag "a"/)
  })
})

describe('kind 0 — the profile', () => {
  it('writes no empty fields, which would be read as "set to nothing"', () => {
    const t = metadataDefinition.build({ name: 'pad', about: '', picture: undefined }, CTX)
    expect(JSON.parse(t.content)).toEqual({ name: 'pad' })
  })

  it('returns an empty profile instead of breaking on unknown fields', () => {
    const parsed = metadataDefinition.parse(
      evento({ kind: 0, content: JSON.stringify({ name: 'pad', campoStrano: 42 }) }),
    )
    expect(parsed.name).toBe('pad')
  })

  it('reports a content that is not JSON clearly', () => {
    expect(() => metadataDefinition.parse(evento({ kind: 0, content: 'non json' }))).toThrow(
      /non JSON/,
    )
  })
})
