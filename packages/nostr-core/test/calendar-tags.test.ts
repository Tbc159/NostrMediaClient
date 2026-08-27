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

describe('indice giornaliero (tag D)', () => {
  it('applica la formula della specifica: floor(secondi / 86400)', () => {
    expect(dayIndex(0)).toBe(0)
    expect(dayIndex(86_399)).toBe(0)
    expect(dayIndex(86_400)).toBe(1)
    // Valore dell'esempio nella specifica.
    expect(dayIndex(82_549 * 86_400)).toBe(82_549)
  })

  it('e ancorato a UTC e non al fuso dell evento', () => {
    // Conseguenza voluta dalla specifica, che calcola l'indice solo dal
    // timestamp: un evento serale a Tokyo cade nel giorno UTC precedente.
    // Introdurre il fuso qui produrrebbe indici incompatibili con quelli
    // degli altri client.
    const seraTokyo = Date.UTC(2026, 8, 1, 14, 0) / 1000 // 23:00 a Tokyo
    expect(dayIndex(seraTokyo)).toBe(dayIndex(Date.UTC(2026, 8, 1, 0, 0) / 1000))
  })

  it('copre un solo giorno se l evento non ha fine', () => {
    expect(dayIndexRange(Date.UTC(2026, 8, 1, 10, 0) / 1000)).toHaveLength(1)
  })

  it('copre tutti i giorni compresi, estremi inclusi', () => {
    const inizio = Date.UTC(2026, 8, 1, 22, 0) / 1000
    const fine = Date.UTC(2026, 8, 4, 3, 0) / 1000
    const giorni = dayIndexRange(inizio, fine)
    expect(giorni).toHaveLength(4)
    expect(giorni[0]).toBe(dayIndex(inizio))
    expect(giorni[giorni.length - 1]).toBe(dayIndex(fine))
    // Consecutivi, senza buchi.
    expect(giorni.every((g, i) => i === 0 || g === (giorni[i - 1] as number) + 1)).toBe(true)
  })

  it('intercetta i timestamp passati per errore in millisecondi', () => {
    // Il caso reale: con i millisecondi la durata risulta mille volte troppo
    // grande e si genererebbero milioni di tag.
    const inizioMs = Date.UTC(2026, 8, 1) // millisecondi, non secondi
    const fineMs = Date.UTC(2026, 8, 2)
    expect(() => dayIndexRange(inizioMs, fineMs)).toThrow(/millisecondi/)
  })

  it('rifiuta una fine precedente all inizio', () => {
    expect(() => dayIndexRange(1_800_000_000, 1_700_000_000)).toThrow(/precede/)
  })

  it('produce tag nella forma attesa', () => {
    expect(buildDayTags(82_549 * 86_400)).toEqual([['D', '82549']])
  })
})

describe('kind 31923 — tag D nell evento', () => {
  const base = { identifier: 'x', title: 'Riunione', start: Date.UTC(2026, 8, 1, 9, 0) / 1000 }

  it('include il tag D, che la specifica indica come obbligatorio', () => {
    const t = calendarTimeEventDefinition.build(base, CTX)
    expect(tagsCon(t.tags, 'D')).toHaveLength(1)
    expect(valori(t.tags, 'D')[0]).toBe(String(dayIndex(base.start)))
  })

  it('include un tag D per ogni giorno coperto da un evento lungo', () => {
    const t = calendarTimeEventDefinition.build({ ...base, end: base.start + 3 * 86_400 }, CTX)
    expect(tagsCon(t.tags, 'D')).toHaveLength(4)
  })

  it('rilegge i tag D presenti nell evento', () => {
    const t = calendarTimeEventDefinition.build({ ...base, end: base.start + 86_400 }, CTX)
    const parsed = calendarTimeEventDefinition.parse(evento({ tags: t.tags }))
    expect(parsed.days).toEqual([dayIndex(base.start), dayIndex(base.start) + 1])
  })

  it('ricava i giorni dall istante se i tag D mancano', () => {
    // Eventi scritti prima che la specifica introducesse il tag: il dato letto
    // resta completo invece di risultare vuoto.
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

describe('kind 31922 — nessun tag D', () => {
  it('non scrive tag D: la specifica non lo prevede per gli eventi su data', () => {
    const t = calendarDateEventDefinition.build(
      { identifier: 'x', title: 'Ferie', start: '2026-08-01', end: '2026-08-08' },
      CTX,
    )
    expect(tagsCon(t.tags, 'D')).toHaveLength(0)
  })
})

describe('tag condivisi rivisti sulla specifica', () => {
  const base = { identifier: 'x', title: 'T', start: '2026-08-01' }

  it('scrive piu tag location, perche la specifica lo definisce ripetibile', () => {
    // Un incontro puo' avere insieme un indirizzo e un link alla videochiamata.
    const t = calendarDateEventDefinition.build(
      { ...base, location: ['Via Roma 1, Milano', 'https://meet.example/abc'] },
      CTX,
    )
    expect(valori(t.tags, 'location')).toEqual(['Via Roma 1, Milano', 'https://meet.example/abc'])
  })

  it('accetta ancora un luogo singolo come stringa', () => {
    const t = calendarDateEventDefinition.build({ ...base, location: 'Milano' }, CTX)
    expect(valori(t.tags, 'location')).toEqual(['Milano'])
  })

  it('scrive relay e ruolo dei partecipanti nelle posizioni previste', () => {
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
    // Il ruolo sta in quarta posizione: serve il campo relay, anche vuoto.
    expect(p[1]).toEqual(['p', 'dd'.repeat(32), '', 'speaker'])
    expect(p[2]).toEqual(['p', 'ee'.repeat(32), 'wss://relay.example', 'host'])
  })

  it('rilegge relay e ruolo dei partecipanti', () => {
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

  it('scrive i tag a verso i calendari a cui proporre l evento', () => {
    const coord = `31924:${CTX.pubkey}:mio-calendario`
    const t = calendarDateEventDefinition.build({ ...base, calendars: [coord] }, CTX)
    expect(valori(t.tags, 'a')).toEqual([coord])
  })
})
