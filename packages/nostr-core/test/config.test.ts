import { describe, expect, it } from 'vitest'

import { draftsEnabled, resolveClientConfig } from '../src/config/defaults.js'

const minimo = {
  NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://relay.damus.io',
  NUXT_PUBLIC_DEFAULT_WRITE_RELAYS: 'wss://relay.damus.io',
}

describe('resolveClientConfig', () => {
  it('spezza le liste separate da virgola tollerando gli spazi', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://a.example , wss://b.example,  wss://c.example',
    })
    expect(config.readRelays).toEqual(['wss://a.example', 'wss://b.example', 'wss://c.example'])
  })

  it('scarta le voci vuote invece di produrre stringhe vuote', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_INDEXER_RELAYS: 'wss://a.example,,  ,wss://b.example',
    })
    expect(config.indexerRelays).toEqual(['wss://a.example', 'wss://b.example'])
  })

  it('esige almeno un relay di lettura e uno di scrittura', () => {
    expect(() => resolveClientConfig({})).toThrow(/relay di lettura/)
    expect(() =>
      resolveClientConfig({ NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://a.example' }),
    ).toThrow(/relay di scrittura/)
  })

  it('rifiuta un URL di relay con schema sbagliato', () => {
    // Fallire all'avvio e' meglio che scoprire a runtime che il client sta
    // parlando con un endpoint che non e' un relay.
    expect(() =>
      resolveClientConfig({ ...minimo, NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'https://a.example' }),
    ).toThrow(/wss:\/\//)
  })

  it('rifiuta un server Blossom con schema sbagliato', () => {
    expect(() =>
      resolveClientConfig({
        ...minimo,
        NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: 'wss://blossom.example',
      }),
    ).toThrow(/https:\/\//)
  })

  it('applica i default per siteUrl e njumpUrl', () => {
    const config = resolveClientConfig(minimo)
    expect(config.siteUrl).toBe('http://localhost:3000')
    expect(config.njumpUrl).toBe('https://njump.me')
  })
})

describe('relay per le bozze', () => {
  it('vale null quando la variabile e assente o vuota', () => {
    expect(resolveClientConfig(minimo).draftRelay).toBeNull()
    expect(resolveClientConfig({ ...minimo, NUXT_PUBLIC_DRAFT_RELAY: '' }).draftRelay).toBeNull()
    expect(resolveClientConfig({ ...minimo, NUXT_PUBLIC_DRAFT_RELAY: '   ' }).draftRelay).toBeNull()
  })

  it('senza relay per le bozze la funzione resta disabilitata, senza ripiegare su uno pubblico', () => {
    // Una bozza (kind 30024) finita su un relay pubblico e' a tutti gli
    // effetti una pubblicazione non voluta. Vedi ADR 0003.
    const config = resolveClientConfig(minimo)
    expect(draftsEnabled(config)).toBe(false)
  })

  it('abilita le bozze quando il relay privato e configurato', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DRAFT_RELAY: 'wss://relay.privato.example',
    })
    expect(config.draftRelay).toBe('wss://relay.privato.example')
    expect(draftsEnabled(config)).toBe(true)
  })
})

describe('normalizzazione degli URL', () => {
  it('toglie gli slash finali dai server Blossom', () => {
    // Un URL copiaincollato con lo slash finale produrrebbe poi "//upload"
    // nelle richieste Blossom, che alcuni server rifiutano.
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: 'https://blossom.example/,https://altro.example///',
    })
    expect(config.blossomServers).toEqual(['https://blossom.example', 'https://altro.example'])
  })

  it('toglie gli slash finali dagli URL dei relay', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://relay.example/',
    })
    expect(config.readRelays).toEqual(['wss://relay.example'])
  })
})
