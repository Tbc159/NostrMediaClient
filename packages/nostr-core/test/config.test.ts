import { describe, expect, it } from 'vitest'

import { draftsEnabled, resolveClientConfig } from '../src/config/defaults.js'

const minimo = {
  NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://relay.damus.io',
  NUXT_PUBLIC_DEFAULT_WRITE_RELAYS: 'wss://relay.damus.io',
}

describe('resolveClientConfig', () => {
  it('splits the comma-separated lists, tolerating spaces', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://a.example , wss://b.example,  wss://c.example',
    })
    expect(config.readRelays).toEqual(['wss://a.example', 'wss://b.example', 'wss://c.example'])
  })

  it('discards the empty entries instead of producing empty strings', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_INDEXER_RELAYS: 'wss://a.example,,  ,wss://b.example',
    })
    expect(config.indexerRelays).toEqual(['wss://a.example', 'wss://b.example'])
  })

  it('requires at least one read relay and one write relay', () => {
    expect(() => resolveClientConfig({})).toThrow(/relay di lettura/)
    expect(() =>
      resolveClientConfig({ NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://a.example' }),
    ).toThrow(/relay di scrittura/)
  })

  it('refuses a relay URL with the wrong scheme', () => {
    // Failing at start-up is better than finding out at runtime that the
    // client is talking to an endpoint that is not a relay.
    expect(() =>
      resolveClientConfig({ ...minimo, NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'https://a.example' }),
    ).toThrow(/wss:\/\//)
  })

  it('refuses a Blossom server with the wrong scheme', () => {
    expect(() =>
      resolveClientConfig({
        ...minimo,
        NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: 'wss://blossom.example',
      }),
    ).toThrow(/https:\/\//)
  })

  it('applies the defaults for siteUrl and njumpUrl', () => {
    const config = resolveClientConfig(minimo)
    expect(config.siteUrl).toBe('http://localhost:3000')
    expect(config.njumpUrl).toBe('https://njump.me')
  })
})

describe('the relay for drafts', () => {
  it('is null when the variable is absent or empty', () => {
    expect(resolveClientConfig(minimo).draftRelay).toBeNull()
    expect(resolveClientConfig({ ...minimo, NUXT_PUBLIC_DRAFT_RELAY: '' }).draftRelay).toBeNull()
    expect(resolveClientConfig({ ...minimo, NUXT_PUBLIC_DRAFT_RELAY: '   ' }).draftRelay).toBeNull()
  })

  it('leaves the feature disabled without a draft relay, with no fallback to a public one', () => {
    // A draft (kind 30024) that ends up on a public relay is to all intents
    // and purposes an unwanted publication. See ADR 0003.
    const config = resolveClientConfig(minimo)
    expect(draftsEnabled(config)).toBe(false)
  })

  it('enables the drafts when the private relay is configured', () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DRAFT_RELAY: 'wss://relay.privato.example',
    })
    expect(config.draftRelay).toBe('wss://relay.privato.example')
    expect(draftsEnabled(config)).toBe(true)
  })
})

describe('the normalisation of the URLs', () => {
  it('strips the trailing slashes from the Blossom servers', () => {
    // A URL copy-pasted with a trailing slash would then produce "//upload"
    // in the Blossom requests, which some servers refuse.
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: 'https://blossom.example/,https://altro.example///',
    })
    expect(config.blossomServers).toEqual(['https://blossom.example', 'https://altro.example'])
  })

  it("strips the trailing slashes from the relays' URLs", () => {
    const config = resolveClientConfig({
      ...minimo,
      NUXT_PUBLIC_DEFAULT_READ_RELAYS: 'wss://relay.example/',
    })
    expect(config.readRelays).toEqual(['wss://relay.example'])
  })
})
