import { describe, expect, it } from 'vitest'

import {
  podcastEpisodeDefinition,
  podcastMetadataDefinition,
} from '../src/kinds/definitions/podcast.js'
import { relayListDefinition } from '../src/kinds/definitions/relay-list.js'
import type { EventTemplate, NostrEvent } from '../src/kinds/types.js'

/**
 * The data a podcast needs to move to NMC without losing anything: the
 * identities the apps recognise it by, the original dates, the numbering, and
 * the Podcasting 2.0 data its listeners depend on.
 */

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

function comeEvento(t: EventTemplate): NostrEvent {
  return { ...t, id: 'ff'.repeat(32), pubkey: CTX.pubkey, sig: '00'.repeat(64) } as NostrEvent
}

const EPISODIO = {
  title: 'S00E02 - Europa inasprisce il MiCA',
  description: 'Mentre l’Europa continua a stringere…',
  audio: [{ url: 'https://blossom.example/ab.m4a', mime: 'audio/mp4' }],
}

const SCHEDA = {
  title: 'Brevi articoli test',
  description: 'Generazione di episodio podcast da articoli.',
  image: 'https://blossom.example/copertina.jpg',
}

const VALORE = {
  tipo: 'lightning',
  metodo: 'keysend',
  suggerito: '0.00000005000',
  destinatari: [
    { nome: 'ThebC', tipo: 'lnaddress', indirizzo: 'thebc@getalby.com', quota: 95, fee: false },
    { nome: 'VecchioHost', tipo: 'node', indirizzo: '03ae9f', quota: 5, fee: true },
  ],
}

describe('an imported episode keeps what the apps know it by', () => {
  const importato = {
    ...EPISODIO,
    guidOriginale: 'f666a2ad-c531-4868-ae1a-da55e791fe65',
    publishedAt: 1_793_107_682,
  }

  it('declares the original GUID with NIP-73', () => {
    const t = podcastEpisodeDefinition.build(importato, CTX)
    expect(t.tags).toContainEqual(['i', 'podcast:item:guid:f666a2ad-c531-4868-ae1a-da55e791fe65'])
    expect(t.tags).toContainEqual(['k', 'podcast:item:guid'])
  })

  it('carries the original date in published_at and keeps created_at truthful', () => {
    const t = podcastEpisodeDefinition.build(importato, CTX)
    expect(t.tags).toContainEqual(['published_at', '1793107682'])
    expect(t.created_at).toBe(CTX.now)
  })

  it('survives the build → parse round trip', () => {
    const letto = podcastEpisodeDefinition.parse(
      comeEvento(podcastEpisodeDefinition.build(importato, CTX)),
    )
    expect(letto.guidOriginale).toBe(importato.guidOriginale)
    expect(letto.publishedAt).toBe(importato.publishedAt)
  })

  it('writes none of it for an episode born on NMC', () => {
    // Its event id is its GUID, and it never changes: a kind 54 is immutable.
    const t = podcastEpisodeDefinition.build(EPISODIO, CTX)
    expect(t.tags.some((x) => x[0] === 'i' || x[0] === 'k' || x[0] === 'published_at')).toBe(false)
  })

  it('refuses a date in the future and a GUID with spaces', () => {
    expect(() =>
      podcastEpisodeDefinition.build({ ...EPISODIO, publishedAt: CTX.now + 1 }, CTX),
    ).toThrow(/futuro/)
    expect(() =>
      podcastEpisodeDefinition.build({ ...EPISODIO, guidOriginale: 'a b' }, CTX),
    ).toThrow(/spazi/)
    expect(() => podcastEpisodeDefinition.build({ ...EPISODIO, guidOriginale: '  ' }, CTX)).toThrow(
      /vuoto/,
    )
  })
})

describe('the numbering of an episode', () => {
  it('writes season, episode and type, and reads them back', () => {
    const t = podcastEpisodeDefinition.build(
      { ...EPISODIO, stagione: 2, numero: 7, tipoEpisodio: 'bonus' },
      CTX,
    )
    expect(t.tags).toContainEqual(['season', '2'])
    expect(t.tags).toContainEqual(['episode', '7'])
    expect(t.tags).toContainEqual(['episode-type', 'bonus'])
    const letto = podcastEpisodeDefinition.parse(comeEvento(t))
    expect([letto.stagione, letto.numero, letto.tipoEpisodio]).toEqual([2, 7, 'bonus'])
  })

  it('refuses numbers that are not positive integers and unknown types', () => {
    expect(() => podcastEpisodeDefinition.build({ ...EPISODIO, numero: 1.5 }, CTX)).toThrow(
      /intero positivo/,
    )
    expect(() => podcastEpisodeDefinition.build({ ...EPISODIO, stagione: 0 }, CTX)).toThrow(
      /intero positivo/,
    )
    expect(() =>
      podcastEpisodeDefinition.build(
        { ...EPISODIO, tipoEpisodio: 'speciale' as unknown as 'full' },
        CTX,
      ),
    ).toThrow(/non ammesso/)
  })

  it('drops an unknown type when reading another client’s event', () => {
    const t = podcastEpisodeDefinition.build(EPISODIO, CTX)
    const letto = podcastEpisodeDefinition.parse(
      comeEvento({ ...t, tags: [...t.tags, ['episode-type', 'speciale']] }),
    )
    expect(letto.tipoEpisodio).toBeUndefined()
  })
})

describe('the Podcasting 2.0 data of an episode', () => {
  const completo = {
    ...EPISODIO,
    trascrizioni: [{ url: 'https://blossom.example/t.vtt', mime: 'text/vtt' }],
    capitoli: { url: 'https://blossom.example/c.json' },
    persone: [{ nome: 'Alice', ruolo: 'guest', link: 'https://alice.example' }],
    valore: VALORE,
  }

  it('writes transcripts, chapters, people and the split as positional tags', () => {
    const t = podcastEpisodeDefinition.build(completo, CTX)
    expect(t.tags).toContainEqual(['transcript', 'https://blossom.example/t.vtt', 'text/vtt'])
    expect(t.tags).toContainEqual([
      'chapters',
      'https://blossom.example/c.json',
      'application/json+chapters',
    ])
    // The empty group between role and link stays, the empty ones at the end go.
    expect(t.tags).toContainEqual(['person', 'Alice', 'guest', '', '', 'https://alice.example'])
    expect(t.tags).toContainEqual(['value', 'lightning', 'keysend', '0.00000005000'])
    expect(t.tags).toContainEqual([
      'value-recipient',
      'ThebC',
      'lnaddress',
      'thebc@getalby.com',
      '95',
    ])
    expect(t.tags).toContainEqual([
      'value-recipient',
      'VecchioHost',
      'node',
      '03ae9f',
      '5',
      '',
      '',
      'true',
    ])
  })

  it('reads all of it back', () => {
    const letto = podcastEpisodeDefinition.parse(
      comeEvento(podcastEpisodeDefinition.build(completo, CTX)),
    )
    expect(letto.trascrizioni).toEqual(completo.trascrizioni)
    expect(letto.capitoli).toEqual({
      url: 'https://blossom.example/c.json',
      mime: 'application/json+chapters',
    })
    expect(letto.persone).toEqual(completo.persone)
    expect(letto.valore).toEqual(VALORE)
  })

  it('refuses a split share that is not a positive integer', () => {
    const storto = {
      ...VALORE,
      destinatari: [{ ...VALORE.destinatari[0]!, quota: 0 }],
    }
    expect(() => podcastEpisodeDefinition.build({ ...EPISODIO, valore: storto }, CTX)).toThrow(
      /intero positivo/,
    )
  })

  it('returns empty lists when an episode has none of it', () => {
    const letto = podcastEpisodeDefinition.parse(
      comeEvento(podcastEpisodeDefinition.build(EPISODIO, CTX)),
    )
    expect(letto.trascrizioni).toEqual([])
    expect(letto.persone).toEqual([])
    expect(letto.valore).toBeUndefined()
  })
})

describe('the show card keeps the show’s identity and voice', () => {
  const completa = {
    ...SCHEDA,
    podcastGuid: '2977094a-c6b7-5d6c-9886-e3337ff33d87',
    feedUrl: 'https://feed.esempio.it/podcast.xml',
    autore: 'ThebC',
    tipo: 'serial' as const,
    valore: VALORE,
    persone: [{ nome: 'ThebC', ruolo: 'host' }],
    finanziamenti: [{ url: 'https://esempio.it/sostieni', testo: 'Sostieni lo show' }],
  }

  it('writes the identity with NIP-73 and the rest as simple tags', () => {
    const t = podcastMetadataDefinition.build(completa, CTX)
    expect(t.tags).toContainEqual(['i', 'podcast:guid:2977094a-c6b7-5d6c-9886-e3337ff33d87'])
    expect(t.tags).toContainEqual(['k', 'podcast:guid'])
    expect(t.tags).toContainEqual(['feed', 'https://feed.esempio.it/podcast.xml'])
    expect(t.tags).toContainEqual(['author', 'ThebC'])
    expect(t.tags).toContainEqual(['type', 'serial'])
    expect(t.tags).toContainEqual(['person', 'ThebC', 'host'])
    expect(t.tags).toContainEqual(['funding', 'https://esempio.it/sostieni', 'Sostieni lo show'])
    expect(t.tags.filter((x) => x[0] === 'value-recipient')).toHaveLength(2)
  })

  it('reads it all back', () => {
    const letto = podcastMetadataDefinition.parse(
      comeEvento(podcastMetadataDefinition.build(completa, CTX)),
    )
    expect(letto).toMatchObject({
      podcastGuid: completa.podcastGuid,
      feedUrl: completa.feedUrl,
      autore: 'ThebC',
      tipo: 'serial',
      valore: VALORE,
      persone: completa.persone,
      finanziamenti: completa.finanziamenti,
    })
  })

  it('accepts only an https feed address, and only valid funding links', () => {
    expect(() =>
      podcastMetadataDefinition.build({ ...SCHEDA, feedUrl: 'http://feed.esempio.it/x.xml' }, CTX),
    ).toThrow(/https/)
    // Plain http on the local machine only, for development.
    const locale = podcastMetadataDefinition.build(
      { ...SCHEDA, feedUrl: 'http://localhost:7451/feed.xml' },
      CTX,
    )
    expect(locale.tags).toContainEqual(['feed', 'http://localhost:7451/feed.xml'])
    expect(() =>
      podcastMetadataDefinition.build({ ...SCHEDA, finanziamenti: [{ url: 'sostienimi' }] }, CTX),
    ).toThrow(/non è un indirizzo web/)
  })

  it('keeps an existing card without the new fields as it was', () => {
    const t = podcastMetadataDefinition.build(SCHEDA, CTX)
    const nomi = new Set(t.tags.map((x) => x[0]))
    for (const nome of ['i', 'k', 'feed', 'author', 'type', 'value', 'person', 'funding']) {
      expect(nomi.has(nome), nome).toBe(false)
    }
  })
})

describe('kind 10002 — the relay list (NIP-65)', () => {
  it('marks read-only and write-only relays, and leaves the both-ways ones bare', () => {
    const t = relayListDefinition.build(
      {
        relays: [
          { url: 'wss://entrambi.example/', lettura: true, scrittura: true },
          { url: 'wss://lettura.example', lettura: true, scrittura: false },
          { url: 'wss://scrittura.example', lettura: false, scrittura: true },
        ],
      },
      CTX,
    )
    expect(t.tags).toEqual([
      ['r', 'wss://entrambi.example'],
      ['r', 'wss://lettura.example', 'read'],
      ['r', 'wss://scrittura.example', 'write'],
      ['client', 'NostrMediaClient'],
    ])
  })

  it('merges the same relay listed twice into one used both ways', () => {
    const t = relayListDefinition.build(
      {
        relays: [
          { url: 'wss://doppio.example', lettura: true, scrittura: false },
          { url: 'wss://doppio.example/', lettura: false, scrittura: true },
        ],
      },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'r')).toEqual([['r', 'wss://doppio.example']])
  })

  it('survives the round trip', () => {
    const letto = relayListDefinition.parse(
      comeEvento(
        relayListDefinition.build(
          { relays: [{ url: 'wss://lettura.example', lettura: true, scrittura: false }] },
          CTX,
        ),
      ),
    )
    expect(letto.relays).toEqual([
      { url: 'wss://lettura.example', lettura: true, scrittura: false },
    ])
  })

  it('refuses an address that is not a relay, and an empty list', () => {
    expect(() =>
      relayListDefinition.build(
        { relays: [{ url: 'https://non-un-relay.example', lettura: true, scrittura: true }] },
        CTX,
      ),
    ).toThrow(/non è l’indirizzo di un relay/)
    expect(() => relayListDefinition.build({ relays: [] }, CTX)).toThrow(/vuota/)
  })
})
