import { describe, expect, it } from 'vitest'

import { noteDefinition } from '../src/kinds/definitions/note.js'
import {
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

describe('nota con allegato (kind 1 + NIP-92)', () => {
  it("mette l'url nel content, non solo nel tag", () => {
    // NIP-92: «Each imeta tag SHOULD match a URL in the event content». Un
    // allegato dichiarato solo nel tag non lo mostrerebbe nessun client: i
    // lettori cercano l'URL nel testo e lo sostituiscono con l'anteprima.
    const t = noteDefinition.build({ content: 'ascolta qui', attachments: [AUDIO] }, CTX)
    expect(t.content).toContain(AUDIO.url)
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(true)
  })

  it("non duplica l'url se e' gia' nel testo", () => {
    const t = noteDefinition.build(
      { content: `senti ${AUDIO.url} che roba`, attachments: [AUDIO] },
      CTX,
    )
    expect(t.content.match(new RegExp(AUDIO.url, 'g'))).toHaveLength(1)
  })

  it('con contenuto vuoto la nota diventa il solo indirizzo', () => {
    const t = noteDefinition.build({ content: '', attachments: [AUDIO] }, CTX)
    expect(t.content).toBe(AUDIO.url)
  })

  it('sopravvive al giro build → parse', () => {
    const t = noteDefinition.build(
      { content: 'con allegato', attachments: [{ ...AUDIO, alt: 'un brano' }] },
      CTX,
    )
    const letto = noteDefinition.parse(evento({ tags: t.tags, content: t.content }))
    expect(letto.attachments).toHaveLength(1)
    expect(letto.attachments[0]?.alt).toBe('un brano')
    expect(letto.attachments[0]?.mime).toBe('audio/mpeg')
  })

  it('una nota senza allegati resta identica a prima', () => {
    // La modifica non deve cambiare cio' che gia' funzionava.
    const t = noteDefinition.build({ content: 'solo testo' }, CTX)
    expect(t.content).toBe('solo testo')
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(false)
  })
})

describe('episodio di podcast (kind 54, NIP-F4)', () => {
  const base = { title: 'Episodio 1', audio: [{ url: AUDIO.url, mime: AUDIO.mime }] }

  it("dichiara l'audio con il tag audio, non con imeta", () => {
    // E' la specifica a volerlo cosi': niente hash e niente dimensione, quindi
    // chi ascolta non puo' verificare che il file sia quello pubblicato.
    const t = podcastEpisodeDefinition.build(base, CTX)
    expect(t.tags).toContainEqual(['audio', AUDIO.url, 'audio/mpeg'])
    expect(t.tags.some((x) => x[0] === 'imeta')).toBe(false)
  })

  it('accetta piu' + ' sorgenti audio, come prevede la specifica', () => {
    const t = podcastEpisodeDefinition.build(
      { ...base, audio: [{ url: 'https://a/1.mp3' }, { url: 'https://b/1.opus' }] },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'audio')).toHaveLength(2)
  })

  it('omette il tipo MIME quando non e' + ' dichiarato', () => {
    const t = podcastEpisodeDefinition.build({ ...base, audio: [{ url: 'https://a/1.mp3' }] }, CTX)
    expect(t.tags).toContainEqual(['audio', 'https://a/1.mp3'])
  })

  it('rifiuta un episodio senza audio', () => {
    expect(() => podcastEpisodeDefinition.build({ ...base, audio: [] }, CTX)).toThrow(/ascoltabile/)
  })

  it('rifiuta un episodio senza titolo', () => {
    expect(() => podcastEpisodeDefinition.build({ ...base, title: '  ' }, CTX)).toThrow(/titolo/)
  })

  it('e' + ' regolare, quindi non modificabile come una nota', () => {
    expect(podcastEpisodeDefinition.class).toBe('regular')
    expect(podcastEpisodeDefinition.editable).toBe(false)
  })

  it('sopravvive al giro build → parse', () => {
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

describe('descrizione del podcast (kind 10154)', () => {
  it('e' + ' replaceable: esiste una versione sola per chiave', () => {
    // NIP-F4 modella ogni podcast come una chiave a se': la scheda dello show
    // sta sulla chiave, e ripubblicarla sostituisce la precedente.
    expect(podcastMetadataDefinition.class).toBe('replaceable')
    expect(podcastMetadataDefinition.editable).toBe(true)
  })

  it('conserva i siti e gli autori con il ruolo', () => {
    const t = podcastMetadataDefinition.build(
      {
        title: 'Il mio podcast',
        websites: ['https://esempio.tld'],
        authors: [{ pubkey: 'cc'.repeat(32), role: 'host' }],
      },
      CTX,
    )
    const letto = podcastMetadataDefinition.parse(evento({ kind: 10154, tags: t.tags }))
    expect(letto.websites).toEqual(['https://esempio.tld'])
    expect(letto.authors[0]).toEqual({ pubkey: 'cc'.repeat(32), role: 'host' })
  })

  it('rifiuta una descrizione senza titolo', () => {
    expect(() => podcastMetadataDefinition.build({ title: '' }, CTX)).toThrow(/titolo/)
  })
})
