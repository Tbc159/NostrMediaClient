import { describe, expect, it } from 'vitest'

import {
  campiDaListe,
  destinazioniLista,
  indirizzoPubblico,
  listeDaConfig,
  soloPubblici,
  stessiRelay,
  stessiServer,
} from '../src/config/liste.js'
import { blossomServersDefinition } from '../src/kinds/definitions/blossom-servers.js'
import type { EventTemplate, NostrEvent } from '../src/kinds/types.js'

/**
 * The endpoints as the key's public lists — kind 10002 for the relays, kind
 * 10063 for the Blossom servers — and back. What counts is that a device
 * starting from the published lists ends up with the same endpoints, and that
 * nothing only this machine can reach ever goes into a public list.
 */

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

function comeEvento(t: EventTemplate): NostrEvent {
  return { ...t, id: 'ff'.repeat(32), pubkey: CTX.pubkey, sig: '00'.repeat(64) } as NostrEvent
}

describe('kind 10063 — the Blossom servers (BUD-03)', () => {
  it('keeps the order, which is the meaning: the first is the primary', () => {
    const t = blossomServersDefinition.build(
      { server: ['https://primo.example/', 'https://secondo.example', 'https://primo.example'] },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'server')).toEqual([
      ['server', 'https://primo.example'],
      ['server', 'https://secondo.example'],
    ])
    expect(blossomServersDefinition.parse(comeEvento(t)).server).toEqual([
      'https://primo.example',
      'https://secondo.example',
    ])
  })

  it('refuses an empty list and an address that is not a server', () => {
    expect(() => blossomServersDefinition.build({ server: [] }, CTX)).toThrow(/vuota/)
    expect(() => blossomServersDefinition.build({ server: ['wss://relay.example'] }, CTX)).toThrow(
      /server/,
    )
  })

  it('reads past what another client may have written', () => {
    const letto = blossomServersDefinition.parse(
      comeEvento({
        kind: 10063,
        content: '',
        created_at: CTX.now,
        tags: [
          ['server', 'https://buono.example'],
          ['server', 'non un url'],
          ['server'],
          ['x', 'y'],
        ],
      }),
    )
    expect(letto.server).toEqual(['https://buono.example'])
  })
})

describe('public addresses', () => {
  it.each([
    ['wss://relay.damus.io', true],
    ['https://blossom.primal.net/', true],
    ['wss://relay.nmc.invalid', true],
    ['ws://relay.damus.io', false],
    ['http://blossom.example', false],
    ['ws://localhost:7447', false],
    ['wss://localhost', false],
    ['wss://127.0.0.1:7447', false],
    ['wss://192.168.1.20', false],
    ['wss://172.20.0.3', false],
    ['wss://100.100.1.1', false],
    ['wss://[::1]:7447', false],
    ['wss://nas.local', false],
    ['wss://relay', false],
    ['non un url', false],
  ])('%s → %s', (url, atteso) => {
    expect(indirizzoPubblico(url)).toBe(atteso)
  })
})

describe('from the configuration to the lists', () => {
  const config = {
    readRelays: ['wss://entrambi.example', 'wss://lettura.example', 'ws://localhost:7447'],
    writeRelays: ['wss://scrittura.example/', 'wss://entrambi.example', 'ws://localhost:7447'],
    blossomServers: ['https://primo.example', 'http://localhost:7449', 'https://secondo.example'],
  }

  it('merges read and write, write order first, and keeps the device’s own addresses out', () => {
    const { liste, esclusi } = listeDaConfig(config)
    expect(liste.relay).toEqual([
      { url: 'wss://scrittura.example', lettura: false, scrittura: true },
      { url: 'wss://entrambi.example', lettura: true, scrittura: true },
      { url: 'wss://lettura.example', lettura: true, scrittura: false },
    ])
    expect(liste.blossom).toEqual(['https://primo.example', 'https://secondo.example'])
    expect(esclusi).toEqual(['ws://localhost:7447', 'http://localhost:7449'])
  })

  it('compares relays as sets, servers in order', () => {
    const { liste } = listeDaConfig(config)
    expect(stessiRelay(liste.relay, [...liste.relay].reverse())).toBe(true)
    expect(stessiRelay(liste.relay, liste.relay.slice(1))).toBe(false)
    expect(
      stessiRelay(liste.relay, [{ ...liste.relay[0]!, lettura: true }, ...liste.relay.slice(1)]),
    ).toBe(false)
    expect(stessiServer(liste.blossom, ['https://primo.example/', 'https://secondo.example'])).toBe(
      true,
    )
    expect(stessiServer(liste.blossom, [...liste.blossom].reverse())).toBe(false)
  })

  it('compares what was published without what a list cannot carry', () => {
    const pubblicata = {
      relay: [{ url: 'ws://localhost:1', lettura: true, scrittura: true }],
      blossom: ['https://primo.example'],
    }
    expect(soloPubblici(pubblicata)).toEqual({ relay: [], blossom: ['https://primo.example'] })
  })
})

describe('from the published lists to the configuration', () => {
  const attuale = {
    readRelays: ['wss://vecchio.example', 'ws://localhost:7447'],
    writeRelays: ['wss://vecchio.example', 'ws://localhost:7447'],
    blossomServers: ['https://vecchio.example', 'http://localhost:7449'],
  }

  it('takes the published lists and keeps the device’s own addresses after them', () => {
    const campi = campiDaListe(
      {
        relay: [
          { url: 'wss://entrambi.example', lettura: true, scrittura: true },
          { url: 'wss://lettura.example', lettura: true, scrittura: false },
        ],
        blossom: ['https://primo.example'],
      },
      attuale,
    )
    expect(campi).toEqual({
      NUXT_PUBLIC_DEFAULT_READ_RELAYS:
        'wss://entrambi.example,wss://lettura.example,ws://localhost:7447',
      NUXT_PUBLIC_DEFAULT_WRITE_RELAYS: 'wss://entrambi.example,ws://localhost:7447',
      NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: 'https://primo.example,http://localhost:7449',
    })
  })

  it('leaves alone a category the list has nothing for', () => {
    const campi = campiDaListe(
      { relay: [{ url: 'wss://lettura.example', lettura: true, scrittura: false }] },
      attuale,
    )
    expect(campi).toEqual({
      NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://lettura.example,ws://localhost:7447',
    })
  })

  it('round trips: the lists of the adopted configuration are the published ones', () => {
    const pubblicate = {
      relay: [
        { url: 'wss://scrittura.example', lettura: false, scrittura: true },
        { url: 'wss://entrambi.example', lettura: true, scrittura: true },
      ],
      blossom: ['https://primo.example', 'https://secondo.example'],
    }
    const campi = campiDaListe(pubblicate, attuale)
    const adottata = {
      readRelays: campi.NUXT_PUBLIC_DEFAULT_READ_RELAYS!.split(','),
      writeRelays: campi.NUXT_PUBLIC_DEFAULT_WRITE_RELAYS!.split(','),
      blossomServers: campi.NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS!.split(','),
    }
    const { liste } = listeDaConfig(adottata)
    expect(stessiRelay(liste.relay, pubblicate.relay)).toBe(true)
    expect(stessiServer(liste.blossom, pubblicate.blossom)).toBe(true)
  })
})

describe('where a new list goes', () => {
  it('to the write relays, the indexers and the previous version’s write relays', () => {
    expect(
      destinazioniLista(
        { writeRelays: ['wss://nuovo.example'], indexerRelays: ['wss://purplepag.es'] },
        [
          { url: 'wss://vecchio.example/', lettura: true, scrittura: true },
          { url: 'wss://solo-lettura.example', lettura: true, scrittura: false },
          { url: 'wss://nuovo.example', lettura: false, scrittura: true },
        ],
      ),
    ).toEqual(['wss://nuovo.example', 'wss://purplepag.es', 'wss://vecchio.example'])
  })
})
