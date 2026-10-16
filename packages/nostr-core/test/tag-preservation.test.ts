import { describe, expect, it } from 'vitest'

import plektos from './fixtures/plektos-event.json' with { type: 'json' }
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { metadataDefinition } from '../src/kinds/definitions/metadata.js'
import { fondiTag, tagAggiuntivi } from '../src/kinds/preservation.js'
import type { NostrEvent, Tag } from '../src/index.js'

/**
 * The real round trip: an event written by another client, reopened and
 * republished from here. The check is not that the code works, it is that the
 * event that comes out **still contains** what the event going in had.
 */

const CTX = { pubkey: plektos.pubkey, now: 1_800_000_000 }
const originale = plektos as NostrEvent
const nomi = (tags: readonly Tag[]): string[] => tags.map((t) => t[0] as string)
const valori = (tags: readonly Tag[], nome: string): string[] =>
  tags.filter((t) => t[0] === nome).map((t) => t[1] as string)

/** Reopens the event as a form does: parse, then rebuild from what was read. */
function riapri(evento: NostrEvent) {
  const dati = calendarTimeEventDefinition.parse(evento)
  const input = {
    identifier: dati.identifier,
    title: dati.title,
    description: dati.description,
    ...(dati.image !== undefined ? { image: dati.image } : {}),
    location: dati.locations,
    hashtags: dati.hashtags,
    start: dati.start,
    ...(dati.end !== undefined ? { end: dati.end } : {}),
    ...(dati.startTzid !== undefined ? { startTzid: dati.startTzid } : {}),
  }
  const comeEra = calendarTimeEventDefinition.build(input, CTX)
  return { dati, input, aggiuntivi: tagAggiuntivi(evento, comeEra) }
}

describe("another client's event, reopened here", () => {
  it('counts as extra only what the kind does not write', () => {
    const { aggiuntivi } = riapri(originale)
    // `lat`, `lon`, `place_id`, the three `c`s, `description`: real data our
    // form knows nothing about. But `g` and `end_tzid` too, which the kind
    // could write and which the form does not pass it: the preservation does
    // not look at what the kind *could* do, it looks at what it did for this
    // event — and that is why it saves the holes in our form as well.
    // Not `client`: that one we write ourselves.
    expect(nomi(aggiuntivi).sort()).toEqual([
      'c',
      'c',
      'c',
      'description',
      'end_tzid',
      'g',
      'lat',
      'lon',
      'place_id',
    ])
    expect(nomi(aggiuntivi)).not.toContain('client')
    expect(nomi(aggiuntivi)).not.toContain('t')
    expect(nomi(aggiuntivi)).not.toContain('d')
  })

  it('has the republished event keep everything it had', () => {
    const { input, aggiuntivi } = riapri(originale)
    const nuovo = calendarTimeEventDefinition.build({ ...input, title: 'Titolo corretto' }, CTX)
    const tags = fondiTag(nuovo.tags, aggiuntivi)

    expect(valori(tags, 'lat')).toEqual(['45.0783053'])
    expect(valori(tags, 'lon')).toEqual(['7.6700284'])
    expect(valori(tags, 'place_id')).toEqual(['88203960'])
    expect(tags.filter((t) => t[0] === 'c')).toEqual([
      ['c', '#f7f5ed', 'background'],
      ['c', '#362b17', 'text'],
      ['c', '#efa906', 'primary'],
    ])
    expect(valori(tags, 'description')).toHaveLength(1)
    expect(valori(tags, 'g')).toEqual(['u0j2qw30h'])
    expect(valori(tags, 'end_tzid')).toEqual(['Europe/Rome'])
    expect(valori(tags, 'd')).toEqual(['bd5c1100-1ad2-44a1-8464-2269b6557df9'])
    expect(valori(tags, 'title')).toEqual(['Titolo corretto'])
    expect(valori(tags, 'client')).toEqual(['NostrMediaClient'])
  })

  it('leaves the hashtags as they were, not five broken words', () => {
    const { input, aggiuntivi } = riapri(originale)
    const tags = fondiTag(calendarTimeEventDefinition.build(input, CTX).tags, aggiuntivi)
    expect(valori(tags, 't')).toEqual([
      'Food & drink',
      'Business & professional',
      'Community & culture',
      'Science & technology',
      'Government & politics',
    ])
  })

  it('does not let the old value back in when a field is emptied', () => {
    // The snapshot is taken when the event is opened: `image` belonged to the
    // kind at that moment, and removing it from the form really removes it.
    const { input, aggiuntivi } = riapri(originale)
    const senzaImmagine = { ...input }
    delete (senzaImmagine as { image?: string }).image
    const tags = fondiTag(calendarTimeEventDefinition.build(senzaImmagine, CTX).tags, aggiuntivi)
    expect(valori(tags, 'image')).toEqual([])
  })

  it('puts a tag added by hand into the event', () => {
    const { input, aggiuntivi } = riapri(originale)
    const tags = fondiTag(calendarTimeEventDefinition.build(input, CTX).tags, [
      ...aggiuntivi,
      ['nome-campo', 'valoreX'],
    ])
    expect(tags).toContainEqual(['nome-campo', 'valoreX'])
  })
})

describe('fondiTag', () => {
  it('discards the exact duplicates but keeps the differing namesakes', () => {
    const fusi = fondiTag(
      [
        ['d', 'x'],
        ['t', 'nostr'],
      ],
      [
        ['t', 'nostr'],
        ['t', 'bitcoin'],
      ],
    )
    expect(fusi).toEqual([
      ['d', 'x'],
      ['t', 'nostr'],
      ['t', 'bitcoin'],
    ])
  })

  it('does not mutate the arrays it receives', () => {
    const costruiti: Tag[] = [['d', 'x']]
    fondiTag(costruiti, [['lat', '1']])
    expect(costruiti).toEqual([['d', 'x']])
  })
})

describe("another client's profile", () => {
  it('keeps the fields we do not know when it is saved again', () => {
    const evento = {
      id: 'ff'.repeat(32),
      pubkey: CTX.pubkey,
      created_at: CTX.now,
      kind: 0,
      tags: [],
      sig: '00'.repeat(64),
      content: JSON.stringify({
        name: 'pad',
        pronouns: 'lui',
        birthday: { day: 1, month: 3 },
      }),
    } as NostrEvent

    const letto = metadataDefinition.parse(evento)
    expect(letto.pronouns).toBe('lui')

    const riscritto = JSON.parse(
      metadataDefinition.build({ ...letto, name: 'pad2' }, CTX).content,
    ) as Record<string, unknown>
    expect(riscritto).toEqual({ name: 'pad2', pronouns: 'lui', birthday: { day: 1, month: 3 } })
  })
})
