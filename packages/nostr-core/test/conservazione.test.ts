import { describe, expect, it } from 'vitest'

import plektos from './fixtures/evento-plektos.json' with { type: 'json' }
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { metadataDefinition } from '../src/kinds/definitions/metadata.js'
import { fondiTag, tagAggiuntivi } from '../src/kinds/conservazione.js'
import type { NostrEvent, Tag } from '../src/index.js'

/**
 * Il giro vero: un evento scritto da un altro client, riaperto e
 * ripubblicato da qui. La prova non e' che il codice funzioni, e' che
 * l'evento che esce **contenga ancora** quello che l'evento che entra aveva.
 */

const CTX = { pubkey: plektos.pubkey, now: 1_800_000_000 }
const originale = plektos as NostrEvent
const nomi = (tags: readonly Tag[]): string[] => tags.map((t) => t[0] as string)
const valori = (tags: readonly Tag[], nome: string): string[] =>
  tags.filter((t) => t[0] === nome).map((t) => t[1] as string)

/** Riapre l'evento come fa un form: parse, poi ricostruzione dai dati letti. */
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

describe('un evento di un altro client, riaperto qui', () => {
  it('riconosce come aggiuntivo solo cio’ che il kind non scrive', () => {
    const { aggiuntivi } = riapri(originale)
    // `lat`, `lon`, `place_id`, i tre `c`, `description`: dati veri di cui il
    // nostro form non sa nulla. Ma anche `g` e `end_tzid`, che il kind
    // saprebbe scrivere e che il form non gli passa: la conservazione non
    // guarda cosa il kind *potrebbe* fare, guarda cosa ha fatto per questo
    // evento — ed e' il motivo per cui salva anche i buchi del nostro form.
    // `client` no: quello lo scriviamo noi.
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

  it('l’evento ripubblicato conserva tutto quello che aveva', () => {
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

  it('gli hashtag restano quelli, non cinque parole spezzate', () => {
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

  it('svuotare un campo non fa rientrare il vecchio valore', () => {
    // La fotografia si scatta all'apertura: `image` apparteneva al kind in
    // quel momento, e toglierla dal form la toglie davvero.
    const { input, aggiuntivi } = riapri(originale)
    const senzaImmagine = { ...input }
    delete (senzaImmagine as { image?: string }).image
    const tags = fondiTag(calendarTimeEventDefinition.build(senzaImmagine, CTX).tags, aggiuntivi)
    expect(valori(tags, 'image')).toEqual([])
  })

  it('un tag aggiunto a mano finisce nell’evento', () => {
    const { input, aggiuntivi } = riapri(originale)
    const tags = fondiTag(calendarTimeEventDefinition.build(input, CTX).tags, [
      ...aggiuntivi,
      ['nome-campo', 'valoreX'],
    ])
    expect(tags).toContainEqual(['nome-campo', 'valoreX'])
  })
})

describe('fondiTag', () => {
  it('scarta i doppioni esatti ma tiene gli omonimi diversi', () => {
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

  it('non muta gli array che riceve', () => {
    const costruiti: Tag[] = [['d', 'x']]
    fondiTag(costruiti, [['lat', '1']])
    expect(costruiti).toEqual([['d', 'x']])
  })
})

describe('profilo di un altro client', () => {
  it('conserva i campi che non conosciamo quando lo si risalva', () => {
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
