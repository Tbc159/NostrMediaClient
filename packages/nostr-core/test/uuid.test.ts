import { describe, expect, it } from 'vitest'

import { NAMESPACE_PODCAST, isUuid, podcastGuidPerUrl, uuidV5 } from '../src/utils/uuid.js'

/**
 * The expected values come from two independent references: Python's
 * `uuid.uuid5`, and the example in the Podcasting 2.0 specification for
 * `podcast:guid` (podnews.net/rss).
 */

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

describe('uuidV5', () => {
  it("matches Python's reference vector in the DNS namespace", async () => {
    expect(await uuidV5(NAMESPACE_DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it("matches the specification's podcast:guid example", async () => {
    expect(await uuidV5(NAMESPACE_PODCAST, 'podnews.net/rss')).toBe(
      '9b024349-ccf0-5f69-a609-6b82873eab3c',
    )
  })

  it('refuses a namespace that is not a UUID', async () => {
    await expect(uuidV5('non-un-uuid', 'x')).rejects.toThrow(/UUID non valido/)
  })
})

describe('podcastGuidPerUrl', () => {
  it('gives the identity the test show already has on Spotify', async () => {
    // The Anchor feed declares no podcast:guid, so this computed one is its
    // identity for Podcast Index: it is what an import must inherit.
    expect(await podcastGuidPerUrl('https://anchor.fm/s/117e26658/podcast/rss')).toBe(
      '2977094a-c6b7-5d6c-9886-e3337ff33d87',
    )
  })

  it('ignores the scheme and the trailing slashes', async () => {
    const atteso = await podcastGuidPerUrl('podnews.net/rss')
    expect(await podcastGuidPerUrl('https://podnews.net/rss')).toBe(atteso)
    expect(await podcastGuidPerUrl('http://podnews.net/rss/')).toBe(atteso)
    expect(atteso).toBe('9b024349-ccf0-5f69-a609-6b82873eab3c')
  })

  it('refuses an empty address', async () => {
    await expect(podcastGuidPerUrl('https://')).rejects.toThrow(/indirizzo del feed/)
  })

  it('produces canonical UUIDs', async () => {
    expect(isUuid(await podcastGuidPerUrl('feed.esempio.it/podcast.xml'))).toBe(true)
  })
})
