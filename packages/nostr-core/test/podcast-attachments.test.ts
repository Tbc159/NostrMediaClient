import { describe, expect, it } from 'vitest'

import { noteDefinition } from '../src/kinds/definitions/note.js'
import {
  authoredPodcastsDefinition,
  podcastEpisodeDefinition,
  podcastMetadataDefinition,
} from '../src/kinds/definitions/podcast.js'
import type { NostrEvent } from '../src/kinds/types.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

function evento(p: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: CTX.pubkey,
    created_at: CTX.now,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

const AUDIO = {
  url: 'https://cdn.example/brano.mp3',
  mime: 'audio/mpeg',
  sha256: 'aa'.repeat(32),
}

describe('a note with an attachment (kind 1 + NIP-92)', () => {
  it('puts the url in the content, not in the tag alone', () => {
    // NIP-92: «Each imeta tag SHOULD match a URL in the event content». No
    // client would show an attachment declared in the tag alone: readers look
    // for the URL in the text and replace it with the preview.
    const t = noteDefinition.build({ content: 'ascolta qui', attachments: [AUDIO] }, CTX)
    expect(t.content).toContain(AUDIO.url)
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(true)
  })

  it('does not duplicate the url when it is in the text already', () => {
    const t = noteDefinition.build(
      { content: `senti ${AUDIO.url} che roba`, attachments: [AUDIO] },
      CTX,
    )
    expect(t.content.match(new RegExp(AUDIO.url, 'g'))).toHaveLength(1)
  })

  it('makes the note the address alone when the content is empty', () => {
    const t = noteDefinition.build({ content: '', attachments: [AUDIO] }, CTX)
    expect(t.content).toBe(AUDIO.url)
  })

  it('survives the build → parse round trip', () => {
    const t = noteDefinition.build(
      { content: 'con allegato', attachments: [{ ...AUDIO, alt: 'un brano' }] },
      CTX,
    )
    const letto = noteDefinition.parse(evento({ tags: t.tags, content: t.content }))
    expect(letto.attachments).toHaveLength(1)
    expect(letto.attachments[0]?.alt).toBe('un brano')
    expect(letto.attachments[0]?.mime).toBe('audio/mpeg')
  })

  it('leaves a note without attachments just as it was', () => {
    // The change must not alter what already worked.
    const t = noteDefinition.build({ content: 'solo testo' }, CTX)
    expect(t.content).toBe('solo testo')
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(false)
  })
})

describe('a podcast episode (kind 54, NIP-F4)', () => {
  const base = {
    title: 'Episodio 1',
    description: 'Di cosa parla.',
    audio: [{ url: AUDIO.url, mime: AUDIO.mime }],
  }

  it('declares the audio with the audio tag, not with imeta', () => {
    // It is the specification that wants it this way: no hash and no size, so
    // the listener cannot verify that the file is the one published.
    const t = podcastEpisodeDefinition.build(base, CTX)
    expect(t.tags).toContainEqual(['audio', AUDIO.url, 'audio/mpeg'])
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(false)
  })

  it('accepts several audio sources, as the specification provides', () => {
    const t = podcastEpisodeDefinition.build(
      { ...base, audio: [{ url: 'https://a/1.mp3' }, { url: 'https://b/1.opus' }] },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'audio')).toHaveLength(2)
  })

  it('omits the MIME type when it is not declared', () => {
    const t = podcastEpisodeDefinition.build({ ...base, audio: [{ url: 'https://a/1.mp3' }] }, CTX)
    expect(t.tags).toContainEqual(['audio', 'https://a/1.mp3'])
  })

  it('refuses an episode without audio', () => {
    expect(() => podcastEpisodeDefinition.build({ ...base, audio: [] }, CTX)).toThrow(/ascoltabile/)
  })

  it('refuses an episode without a title', () => {
    expect(() => podcastEpisodeDefinition.build({ ...base, title: '  ' }, CTX)).toThrow(/titolo/)
  })

  it('refuses an episode without a description, which NIP-F4 makes mandatory', () => {
    // The parse tolerates it missing: other people's events are not ours to write.
    expect(() => podcastEpisodeDefinition.build({ ...base, description: ' ' }, CTX)).toThrow(
      /descrizione/,
    )
    const letto = podcastEpisodeDefinition.parse(
      evento({
        kind: 54,
        tags: [
          ['title', 'x'],
          ['audio', AUDIO.url],
        ],
      }),
    )
    expect(letto.description).toBeUndefined()
  })

  it('is regular, hence no more editable than a note', () => {
    expect(podcastEpisodeDefinition.class).toBe('regular')
    expect(podcastEpisodeDefinition.editable).toBe(false)
  })

  it('survives the build → parse round trip', () => {
    const t = podcastEpisodeDefinition.build(
      { ...base, content: 'Note dell’episodio.', description: 'Un riassunto.' },
      CTX,
    )
    const letto = podcastEpisodeDefinition.parse(
      evento({ kind: 54, tags: t.tags, content: t.content }),
    )
    expect(letto.title).toBe('Episodio 1')
    expect(letto.description).toBe('Un riassunto.')
    expect(letto.audio[0]?.url).toBe(AUDIO.url)
  })
})

describe("the podcast's description (kind 10154)", () => {
  it('is replaceable: there is a single version per key', () => {
    // NIP-F4 models every podcast as a key of its own: the show's card sits on
    // the key, and republishing it replaces the previous one.
    expect(podcastMetadataDefinition.class).toBe('replaceable')
    expect(podcastMetadataDefinition.editable).toBe(true)
  })

  const scheda = {
    title: 'Il mio podcast',
    description: 'Un podcast di prova.',
    image: 'https://esempio.tld/copertina.png',
  }

  it('keeps the websites and the authors with their role', () => {
    const t = podcastMetadataDefinition.build(
      {
        ...scheda,
        websites: ['https://esempio.tld'],
        authors: [{ pubkey: 'cc'.repeat(32), role: 'host' }],
      },
      CTX,
    )
    const letto = podcastMetadataDefinition.parse(evento({ kind: 10154, tags: t.tags }))
    expect(letto.websites).toEqual(['https://esempio.tld'])
    expect(letto.authors[0]).toEqual({ pubkey: 'cc'.repeat(32), role: 'host' })
  })

  it('refuses a card without a title', () => {
    expect(() => podcastMetadataDefinition.build({ ...scheda, title: '' }, CTX)).toThrow(/titolo/)
  })

  it('refuses a card without an image or without a description: NIP-F4 wants both', () => {
    expect(() => podcastMetadataDefinition.build({ ...scheda, image: '' }, CTX)).toThrow(/immagine/)
    expect(() => podcastMetadataDefinition.build({ ...scheda, description: '' }, CTX)).toThrow(
      /descrizione/,
    )
  })
})

describe('the podcasts I am an author of (kind 10064)', () => {
  const PODCAST = 'dd'.repeat(32)

  it('is replaceable: a single list per person', () => {
    expect(authoredPodcastsDefinition.class).toBe('replaceable')
    expect(authoredPodcastsDefinition.editable).toBe(true)
  })

  it('names the podcasts with one p tag each, without duplicates', () => {
    // It is the author who declares themselves: the podcast's card on its own
    // can claim anyone, and only the cross-check from this side confirms it.
    const t = authoredPodcastsDefinition.build({ podcasts: [PODCAST, PODCAST.toUpperCase()] }, CTX)
    expect(t.tags.filter((x) => x[0] === 'p')).toEqual([['p', PODCAST]])
    expect(t.content).toBe('')
  })

  it('survives the build → parse round trip and discards what is not a key', () => {
    const t = authoredPodcastsDefinition.build({ podcasts: [PODCAST, 'ee'.repeat(32)] }, CTX)
    const letto = authoredPodcastsDefinition.parse(
      evento({ kind: 10064, tags: [...t.tags, ['p', 'non-una-chiave']] }),
    )
    expect(letto.podcasts).toEqual([PODCAST, 'ee'.repeat(32)])
  })

  it('refuses an empty list, and says what to do instead', () => {
    expect(() => authoredPodcastsDefinition.build({ podcasts: ['  ', 'x'] }, CTX)).toThrow(
      /cancella/,
    )
  })
})

describe('beyond NIP-F4: what the platforms demand', () => {
  const scheda = {
    title: 'Show',
    description: 'D.',
    image: 'https://b.example/c.png',
  }

  it('has the card carry the category, language, email and explicit flag, and read them back', () => {
    const t = podcastMetadataDefinition.build(
      {
        ...scheda,
        categories: [{ principale: 'News', sotto: 'Daily News' }, { principale: 'Technology' }],
        language: 'IT',
        email: 'owner@esempio.tld',
        contentWarning: '',
        websites: ['https://esempio.tld', 'https://podcasts.apple.com/x', 'https://esempio.tld'],
      },
      CTX,
    )
    expect(t.tags).toContainEqual(['category', 'News', 'Daily News'])
    expect(t.tags).toContainEqual(['category', 'Technology'])
    expect(t.tags).toContainEqual(['language', 'it'])
    expect(t.tags).toContainEqual(['email', 'owner@esempio.tld'])
    expect(t.tags).toContainEqual(['content-warning', ''])
    // The websites: no duplicates, in order — the first is the feed's <link>.
    expect(t.tags.filter((x) => x[0] === 'website')).toEqual([
      ['website', 'https://esempio.tld'],
      ['website', 'https://podcasts.apple.com/x'],
    ])

    const letto = podcastMetadataDefinition.parse(evento({ kind: 10154, tags: t.tags }))
    expect(letto.categories).toEqual([
      { principale: 'News', sotto: 'Daily News' },
      { principale: 'Technology' },
    ])
    expect(letto.language).toBe('it')
    expect(letto.email).toBe('owner@esempio.tld')
    expect(letto.contentWarning).toBe('')
  })

  it('refuses a category Apple does not have, a non-ISO language, a crooked email', () => {
    expect(() =>
      podcastMetadataDefinition.build({ ...scheda, categories: [{ principale: 'Podcast' }] }, CTX),
    ).toThrow(/non è una categoria/)
    expect(() =>
      podcastMetadataDefinition.build(
        { ...scheda, categories: [{ principale: 'News', sotto: 'Improv' }] },
        CTX,
      ),
    ).toThrow(/non è una categoria/)
    expect(() => podcastMetadataDefinition.build({ ...scheda, language: 'italiano' }, CTX)).toThrow(
      /ISO 639-1/,
    )
    expect(() =>
      podcastMetadataDefinition.build({ ...scheda, email: 'senza-chiocciola' }, CTX),
    ).toThrow(/email/)
  })

  it('accepts at most three categories', () => {
    const quattro = ['News', 'Technology', 'History', 'Government'].map((principale) => ({
      principale,
    }))
    expect(() => podcastMetadataDefinition.build({ ...scheda, categories: quattro }, CTX)).toThrow(
      /massimo 3/,
    )
  })

  it("reads another's card with an unknown category without breaking", () => {
    // Tolerant when reading: we are not the ones who wrote it.
    const letto = podcastMetadataDefinition.parse(
      evento({
        kind: 10154,
        tags: [
          ['title', 'X'],
          ['category', 'Boh'],
        ],
      }),
    )
    expect(letto.categories).toEqual([{ principale: 'Boh' }])
  })

  it('has the episode carry the duration in whole seconds and the explicit flag', () => {
    const t = podcastEpisodeDefinition.build(
      {
        title: 'E',
        description: 'D',
        audio: [{ url: AUDIO.url, mime: AUDIO.mime }],
        duration: 1234.6,
        contentWarning: 'linguaggio',
      },
      CTX,
    )
    expect(t.tags).toContainEqual(['duration', '1235'])
    expect(t.tags).toContainEqual(['content-warning', 'linguaggio'])
    const letto = podcastEpisodeDefinition.parse(evento({ kind: 54, tags: t.tags }))
    expect(letto.duration).toBe(1235)
    expect(letto.contentWarning).toBe('linguaggio')
  })
})
