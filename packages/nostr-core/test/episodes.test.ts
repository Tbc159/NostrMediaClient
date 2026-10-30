import { describe, expect, it } from 'vitest'

import {
  VERSIONE_BOZZA_EPISODIO,
  completezzaEpisodio,
  creaBozzaEpisodio,
  leggiBozzaEpisodio,
  type AllegatoBozza,
} from '../src/episodes/index.js'

/**
 * An episode draft is a single object with three uses: saved, downloaded as a
 * proposal, imported from another identity. The checks that count are that it
 * survives the trip through JSON without losing anything, that it says what is
 * missing without throwing, and that it refuses what it cannot read with an
 * explanation.
 */

const AUDIO: AllegatoBozza = {
  nome: 'puntata.mp3',
  imeta: { url: 'https://blossom.example/ab12.mp3', mime: 'audio/mpeg', sha256: 'ab12', size: 10 },
  descrittore: {
    url: 'https://blossom.example/ab12.mp3',
    sha256: 'ab12',
    size: 10,
    type: 'audio/mpeg',
    uploaded: 1_800_000_000,
  },
  copie: ['https://blossom.example'],
}

const ADESSO = () => 1_800_000_100

describe('creating and reading back', () => {
  it('survives the JSON round trip without losing anything', () => {
    const bozza = creaBozzaEpisodio({
      preparataDa: 'npub1preparatore',
      perChiave: 'npub1podcast',
      episodio: {
        titolo: 'Episodio 1',
        descrizione: 'Di cosa parla.',
        contenuto: 'Note.',
        hashtag: ['bitcoin'],
        immagine: 'https://blossom.example/copertina.png',
      },
      allegati: [AUDIO],
      adesso: ADESSO,
    })

    const riletta = leggiBozzaEpisodio(JSON.stringify(bozza))
    expect(riletta).toEqual(bozza)
    expect(riletta.versione).toBe(VERSIONE_BOZZA_EPISODIO)
    expect(riletta.id).toMatch(/^episodio-/)
    expect(riletta.creataAlle).toBe(1_800_000_100)
  })

  it('keeps the id and the creation date when saved again', () => {
    // A draft picked up and saved again is the same draft: the list must not
    // show two of them.
    const prima = creaBozzaEpisodio({
      episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
      allegati: [],
      adesso: () => 100,
    })
    const dopo = creaBozzaEpisodio({
      id: prima.id,
      creataAlle: prima.creataAlle,
      episodio: { ...prima.episodio, titolo: 'Ora ha un titolo' },
      allegati: [],
      adesso: () => 200,
    })
    expect(dopo.id).toBe(prima.id)
    expect(dopo.creataAlle).toBe(100)
    expect(dopo.aggiornataAlle).toBe(200)
  })

  it('can be empty: that is its purpose', () => {
    expect(() =>
      creaBozzaEpisodio({
        episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
        allegati: [],
      }),
    ).not.toThrow()
  })
})

describe('what it refuses, and how it says so', () => {
  it('a file that is not JSON', () => {
    expect(() => leggiBozzaEpisodio('{ non json')).toThrow(/JSON/)
  })

  it('a version it does not know, naming it', () => {
    // Better to say so than to load a half-filled form with no explanation.
    expect(() => leggiBozzaEpisodio(JSON.stringify({ versione: 7, kind: 54 }))).toThrow(
      /versione 7/,
    )
  })

  it('any old JSON, pointing at the field', () => {
    expect(() => leggiBozzaEpisodio(JSON.stringify({ versione: 1, kind: 54 }))).toThrow(
      /Non è una bozza/,
    )
  })

  it('an attachment without a descriptor: without one it cannot be re-adopted', () => {
    const rotta = {
      versione: 1,
      kind: 54,
      id: 'x',
      creataAlle: 1,
      aggiornataAlle: 1,
      episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
      allegati: [{ nome: 'a.mp3', imeta: { url: 'u' }, copie: [] }],
    }
    expect(() => leggiBozzaEpisodio(JSON.stringify(rotta))).toThrow(/allegati/)
  })
})

describe('completeness', () => {
  const vuota = {
    episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
    allegati: [],
  }

  it('lists what is missing, in the order it should be filled in', () => {
    expect(completezzaEpisodio(vuota)).toEqual({
      pronta: false,
      manca: ['il titolo', 'la descrizione', 'un file audio su Blossom'],
    })
  })

  it('does not count an image as audio', () => {
    const conImmagine = {
      ...vuota,
      episodio: { ...vuota.episodio, titolo: 'T', descrizione: 'D' },
      allegati: [
        {
          ...AUDIO,
          imeta: { url: 'https://blossom.example/c.png', mime: 'image/png' },
          descrittore: { ...AUDIO.descrittore, type: 'image/png' },
        },
      ],
    }
    expect(completezzaEpisodio(conImmagine).manca).toEqual(['un file audio su Blossom'])
  })

  it('is ready with a title, a description and an audio file', () => {
    expect(
      completezzaEpisodio({
        episodio: { titolo: 'T', descrizione: 'D', contenuto: '', hashtag: [] },
        allegati: [AUDIO],
      }),
    ).toEqual({ pronta: true, manca: [] })
  })
})
