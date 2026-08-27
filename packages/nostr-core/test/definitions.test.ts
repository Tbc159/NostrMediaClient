import { describe, expect, it } from 'vitest'

import { calendarDateEventDefinition } from '../src/kinds/definitions/calendar-date.js'
import { calendarRsvpDefinition } from '../src/kinds/definitions/calendar-rsvp.js'
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { metadataDefinition } from '../src/kinds/definitions/metadata.js'
import { noteDefinition } from '../src/kinds/definitions/note.js'
import type { NostrEvent } from '../src/kinds/types.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

/** Evento minimo per i test di parsing. */
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

/** Valore del primo tag con quel nome nel template costruito. */
const tag = (tags: string[][], nome: string): string | undefined =>
  tags.find((t) => t[0] === nome)?.[1]

describe('kind 1 — nota', () => {
  it('marca radice e padre quando risponde dentro un thread', () => {
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

  it('usa un solo tag marcato root quando risponde direttamente alla radice', () => {
    const t = noteDefinition.build(
      { content: 'ok', replyTo: { id: 'aa'.repeat(32), pubkey: 'cc'.repeat(32) } },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'e')).toEqual([['e', 'aa'.repeat(32), '', 'root']])
  })

  it('riporta gli autori del thread senza duplicarli', () => {
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

  it('normalizza gli hashtag togliendo il cancelletto e abbassando le maiuscole', () => {
    const t = noteDefinition.build({ content: 'x', hashtags: ['#Nostr', 'CALENDARIO'] }, CTX)
    expect(t.tags.filter((x) => x[0] === 't')).toEqual([
      ['t', 'nostr'],
      ['t', 'calendario'],
    ])
  })

  it('interpreta i thread vecchi con tag e non marcati', () => {
    // Convenzione pre-marcatori: primo `e` = radice, ultimo = risposta diretta.
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

  it('non e' + ' modificabile: il protocollo non lo consente', () => {
    expect(noteDefinition.editable).toBe(false)
  })
})

describe('kind 31922 — evento su data', () => {
  const base = { identifier: 'id-1', title: 'Ferie', start: '2026-08-01' }

  it('accetta un end successivo allo start', () => {
    const t = calendarDateEventDefinition.build({ ...base, end: '2026-08-08' }, CTX)
    expect(tag(t.tags, 'end')).toBe('2026-08-08')
  })

  it('rifiuta un end uguale allo start, perche' + ' NIP-52 lo definisce esclusivo', () => {
    // Un evento di un giorno solo omette end oppure lo mette al giorno dopo:
    // end uguale a start descriverebbe una durata nulla.
    expect(() => calendarDateEventDefinition.build({ ...base, end: '2026-08-01' }, CTX)).toThrow(
      /esclusivo/,
    )
  })

  it('rifiuta una data inesistente nel calendario', () => {
    expect(() => calendarDateEventDefinition.build({ ...base, start: '2026-02-30' }, CTX)).toThrow()
  })

  it('non scrive tag vuoti per i campi opzionali non valorizzati', () => {
    const t = calendarDateEventDefinition.build(base, CTX)
    const nomi = t.tags.map((x) => x[0])
    expect(nomi).not.toContain('location')
    expect(nomi).not.toContain('image')
    expect(nomi).not.toContain('summary')
  })
})

describe('kind 31923 — evento su orario', () => {
  const base = {
    identifier: 'id-2',
    title: 'Riunione',
    start: 1_800_000_000,
    startTzid: 'Asia/Tokyo',
  }

  it('conserva il fuso orario accanto al timestamp', () => {
    // Il timestamp dice quando accade, il tzid come va mostrato: servono
    // entrambi, e il fuso non e' ricavabile dall'istante.
    const t = calendarTimeEventDefinition.build(base, CTX)
    expect(tag(t.tags, 'start')).toBe('1800000000')
    expect(tag(t.tags, 'start_tzid')).toBe('Asia/Tokyo')
  })

  it('omette end_tzid quando coincide con quello di inizio', () => {
    const t = calendarTimeEventDefinition.build(
      { ...base, end: base.start + 3600, endTzid: 'Asia/Tokyo' },
      CTX,
    )
    expect(tag(t.tags, 'end_tzid')).toBeUndefined()
  })

  it('scrive end_tzid quando l' + "'evento cambia fuso", () => {
    const t = calendarTimeEventDefinition.build(
      { ...base, end: base.start + 36000, endTzid: 'Europe/Rome' },
      CTX,
    )
    expect(tag(t.tags, 'end_tzid')).toBe('Europe/Rome')
  })

  it('esige una fine strettamente successiva all inizio', () => {
    // NIP-52: «start ... Must be less than end, if it exists». Una fine uguale
    // all'inizio descriverebbe una durata nulla, che si esprime omettendo end.
    expect(() => calendarTimeEventDefinition.build({ ...base, end: base.start - 1 }, CTX)).toThrow(
      /successiva/,
    )
    expect(() => calendarTimeEventDefinition.build({ ...base, end: base.start }, CTX)).toThrow(
      /successiva/,
    )
  })

  it('rifiuta un fuso orario inventato', () => {
    expect(() =>
      calendarTimeEventDefinition.build({ ...base, startTzid: 'Marte/Olympus' }, CTX),
    ).toThrow()
  })

  it('rifiuta in lettura un evento senza start', () => {
    expect(() =>
      calendarTimeEventDefinition.parse(evento({ kind: 31923, tags: [['d', 'x']] })),
    ).toThrow(/senza tag "start"/)
  })

  it('sopravvive a un round-trip build → parse mantenendo il fuso', () => {
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

  it('punta alla coordinata dell' + "'evento, non al suo id", () => {
    // Gli eventi calendario sono addressable: legare l'RSVP all'id lo
    // aggancerebbe a una versione che l'organizzatore puo' sostituire.
    const t = calendarRsvpDefinition.build(base, CTX)
    expect(tag(t.tags, 'a')).toBe(`31923:${CTX.pubkey}:id-2`)
  })

  it('scarta la disponibilita' + ' su un rifiuto', () => {
    const t = calendarRsvpDefinition.build({ ...base, status: 'declined', freebusy: 'free' }, CTX)
    expect(tag(t.tags, 'fb')).toBeUndefined()
    expect(tag(t.tags, 'status')).toBe('declined')
  })

  it('mantiene la disponibilita' + ' su una partecipazione', () => {
    const t = calendarRsvpDefinition.build({ ...base, freebusy: 'busy' }, CTX)
    expect(tag(t.tags, 'fb')).toBe('busy')
  })

  it('rifiuta in lettura un RSVP senza riferimento all' + "'evento", () => {
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

describe('kind 0 — profilo', () => {
  it('non scrive i campi vuoti, che verrebbero letti come "impostato a niente"', () => {
    const t = metadataDefinition.build({ name: 'pad', about: '', picture: undefined }, CTX)
    expect(JSON.parse(t.content)).toEqual({ name: 'pad' })
  })

  it('restituisce un profilo vuoto invece di rompersi su campi sconosciuti', () => {
    const parsed = metadataDefinition.parse(
      evento({ kind: 0, content: JSON.stringify({ name: 'pad', campoStrano: 42 }) }),
    )
    expect(parsed.name).toBe('pad')
  })

  it('segnala chiaramente un content che non e' + ' JSON', () => {
    expect(() => metadataDefinition.parse(evento({ kind: 0, content: 'non json' }))).toThrow(
      /non JSON/,
    )
  })
})
