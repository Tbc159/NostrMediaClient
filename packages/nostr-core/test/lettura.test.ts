import { describe, expect, it } from 'vitest'

import { KIND_DA_INDICIZZATORI, relayPerLeggere } from '../src/relays/lettura.js'

/**
 * Il caso vero: un profilo sopravvissuto solo sugli indicizzatori. Il client
 * non li interrogava, e mostrava l'npub al posto del nome.
 */

const CONFIG = {
  readRelays: ['wss://uno.tld', 'wss://due.tld'],
  writeRelays: ['wss://due.tld', 'wss://tre.tld'],
  indexerRelays: ['wss://purplepag.es', 'wss://user.kindpag.es'],
}

describe('relayPerLeggere', () => {
  it('per il profilo (kind 0) chiede anche agli indicizzatori', () => {
    expect(relayPerLeggere(0, CONFIG)).toEqual([
      'wss://uno.tld',
      'wss://due.tld',
      'wss://tre.tld',
      'wss://purplepag.es',
      'wss://user.kindpag.es',
    ])
  })

  it('per la lista dei relay e i server Blossom pure', () => {
    for (const kind of [3, 10002, 10063]) {
      expect(relayPerLeggere(kind, CONFIG)).toContain('wss://purplepag.es')
    }
  })

  it('per un articolo o un episodio non li interroga: non li tengono', () => {
    // Un EOSE vuoto e' tempo perso, e su un indicizzatore un kind 30023 non
    // c'e' per definizione.
    for (const kind of [1, 54, 1063, 10154, 30023, 31923]) {
      expect(relayPerLeggere(kind, CONFIG)).toEqual([
        'wss://uno.tld',
        'wss://due.tld',
        'wss://tre.tld',
      ])
    }
  })

  it('non ripete un relay che compare in due elenchi', () => {
    const fusi = relayPerLeggere(0, {
      readRelays: ['wss://uno.tld', 'wss://purplepag.es'],
      writeRelays: ['wss://uno.tld'],
      indexerRelays: ['wss://purplepag.es'],
    })
    expect(fusi).toEqual(['wss://uno.tld', 'wss://purplepag.es'])
  })

  it('regge una configurazione senza indicizzatori', () => {
    expect(relayPerLeggere(0, { ...CONFIG, indexerRelays: [] })).toEqual([
      'wss://uno.tld',
      'wss://due.tld',
      'wss://tre.tld',
    ])
  })

  it('l’elenco dei kind resta corto e dichiarato', () => {
    expect([...KIND_DA_INDICIZZATORI]).toEqual([0, 3, 10002, 10063])
  })
})
