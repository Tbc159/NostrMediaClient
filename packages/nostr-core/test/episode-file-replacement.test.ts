import { describe, expect, it } from 'vitest'

import { podcastEpisodeDefinition } from '../src/kinds/definitions/podcast.js'
import {
  dataNelFeed,
  guidNelFeed,
  sostituisciFileEpisodio,
  ultimaVersionePerGuid,
} from '../src/podcast/sostituzione.js'
import { fileSuBlossom } from '../src/media/blossom.js'
import type { NostrEvent, Tag } from '../src/index.js'

/**
 * Replacing an episode's file: the feed service keeps the newest kind 54 per
 * GUID, so the new event must be the same episode for the apps — same GUID,
 * same date, same everything but the file.
 */

const PK = 'a'.repeat(64)
const CREATO = 1_790_000_000

function evento(input: Parameters<typeof podcastEpisodeDefinition.build>[0], extra: Tag[] = []) {
  const t = podcastEpisodeDefinition.build(input, { pubkey: PK, now: CREATO })
  return {
    ...t,
    tags: [...t.tags, ...extra],
    id: 'e'.repeat(64),
    pubkey: PK,
    sig: 'f'.repeat(128),
  } as NostrEvent
}

const importato = evento(
  {
    title: 'Episodio 1',
    description: 'Il primo',
    image: 'https://d3t3ozftmdmh3i.cloudfront.net/cover.jpg',
    audio: [{ url: 'https://anchor.fm/s/1/podcast/play/1/ep1.mp3', mime: 'audio/mpeg' }],
    duration: 297,
    guidOriginale: '5b0a0828-92a6-4c14-a656-ea81951dd6f0',
    publishedAt: 1_790_000_000 - 86_400 * 30,
    stagione: 1,
    numero: 2,
    tipoEpisodio: 'full',
  },
  [['alt', 'Episodio di podcast']],
)

const nativo = evento({
  title: 'Episodio NMC',
  description: 'Nato qui',
  audio: [{ url: 'https://blossom.example/abc.mp3', mime: 'audio/mpeg' }],
})

const tag = (t: { tags: Tag[] }, nome: string) => t.tags.filter((x) => x[0] === nome)

describe('sostituisciFileEpisodio', () => {
  it('changes the audio and keeps GUID, date and every other tag', () => {
    const nuovo = sostituisciFileEpisodio(
      importato,
      { audio: { url: 'https://blossom.example/' + '1'.repeat(64) + '.mp3', mime: 'audio/mpeg' } },
      CREATO + 100,
    )
    expect(tag(nuovo, 'audio')).toEqual([
      ['audio', 'https://blossom.example/' + '1'.repeat(64) + '.mp3', 'audio/mpeg'],
    ])
    expect(nuovo.created_at).toBe(CREATO + 100)
    const firmato = { ...nuovo, id: '1'.repeat(64), pubkey: PK, sig: '' } as NostrEvent
    expect(guidNelFeed(firmato)).toBe(guidNelFeed(importato))
    expect(dataNelFeed(firmato)).toBe(dataNelFeed(importato))
    for (const nome of ['title', 'description', 'image', 'duration', 'season', 'episode', 'alt']) {
      expect(tag(nuovo, nome)).toEqual(tag(importato, nome))
    }
  })

  it('changes the image alone', () => {
    const nuovo = sostituisciFileEpisodio(
      importato,
      { immagine: 'https://blossom.example/cover.jpg' },
      CREATO + 1,
    )
    expect(tag(nuovo, 'image')).toEqual([['image', 'https://blossom.example/cover.jpg']])
    expect(tag(nuovo, 'audio')).toEqual(tag(importato, 'audio'))
  })

  it('updates the duration when the new file has one', () => {
    const nuovo = sostituisciFileEpisodio(
      importato,
      { audio: { url: 'https://blossom.example/x.mp3' }, durata: 301.4 },
      CREATO + 1,
    )
    expect(tag(nuovo, 'duration')).toEqual([['duration', '301']])
  })

  it('pins the identity of an episode born on NMC, which the feed knew by id and created_at', () => {
    const nuovo = sostituisciFileEpisodio(
      nativo,
      { audio: { url: 'https://blossom.example/y.mp3' } },
      CREATO + 5,
    )
    const firmato = { ...nuovo, id: '2'.repeat(64), pubkey: PK, sig: '' } as NostrEvent
    expect(guidNelFeed(firmato)).toBe(nativo.id)
    expect(dataNelFeed(firmato)).toBe(CREATO)
  })

  it('refuses nothing to replace, and a clock behind the original', () => {
    expect(() => sostituisciFileEpisodio(importato, {}, CREATO + 1)).toThrow()
    expect(() =>
      sostituisciFileEpisodio(importato, { immagine: 'https://x/y.jpg' }, CREATO),
    ).toThrow(/orologio/)
  })
})

describe('ultimaVersionePerGuid', () => {
  it('keeps the newest event per GUID, newest episode first', () => {
    const sostituito = {
      ...sostituisciFileEpisodio(importato, { audio: { url: 'https://b/z.mp3' } }, CREATO + 10),
      id: '3'.repeat(64),
      pubkey: PK,
      sig: '',
    } as NostrEvent
    const nativoPiuRecente = { ...nativo, id: '4'.repeat(64), created_at: CREATO + 20 }
    const elenco = ultimaVersionePerGuid([importato, nativoPiuRecente, sostituito])
    expect(elenco.map((e) => e.id)).toEqual([nativoPiuRecente.id, sostituito.id])
  })
})

describe('fileSuBlossom', () => {
  const server = ['https://blossom.yakihonne.com']
  it('tells Blossom from the old host', () => {
    expect(fileSuBlossom('https://blossom.yakihonne.com/abc.mp3', server)).toBe(true)
    expect(fileSuBlossom(`https://altro.example/${'0'.repeat(64)}.mp3`, server)).toBe(true)
    expect(fileSuBlossom('https://anchor.fm/s/1/podcast/play/1/ep.mp3', server)).toBe(false)
    expect(fileSuBlossom('https://d3t3ozftmdmh3i.cloudfront.net/cover.jpg', server)).toBe(false)
    expect(fileSuBlossom('non un url', server)).toBe(false)
  })
})
