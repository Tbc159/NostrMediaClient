import { describe, expect, it } from 'vitest'

import {
  VERSIONE_BOZZA_EPISODIO,
  completezzaEpisodio,
  creaBozzaEpisodio,
  leggiBozzaEpisodio,
  type AllegatoBozza,
} from '../src/episodi/index.js'

/**
 * La bozza di episodio e' un oggetto solo con tre usi: salvata, scaricata come
 * proposta, importata da un'altra identita'. Le prove che contano sono che
 * sopravviva al giro per JSON senza perdere nulla, che dica cosa manca senza
 * lanciare, e che rifiuti cio' che non sa leggere spiegandosi.
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

describe('creare e rileggere', () => {
  it('sopravvive al giro JSON senza perdere nulla', () => {
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

  it('conserva l’id e la data di creazione quando si risalva', () => {
    // Una bozza ripresa e salvata di nuovo e' la stessa bozza: l'elenco non
    // deve mostrarne due.
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

  it('puo’ essere vuota: e’ il suo scopo', () => {
    expect(() =>
      creaBozzaEpisodio({
        episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
        allegati: [],
      }),
    ).not.toThrow()
  })
})

describe('cosa rifiuta, e come lo dice', () => {
  it('un file che non e’ JSON', () => {
    expect(() => leggiBozzaEpisodio('{ non json')).toThrow(/JSON/)
  })

  it('una versione che non conosce, nominandola', () => {
    // Meglio dirlo che caricare un form a meta' senza spiegazioni.
    expect(() => leggiBozzaEpisodio(JSON.stringify({ versione: 7, kind: 54 }))).toThrow(
      /versione 7/,
    )
  })

  it('un JSON qualunque, indicando il campo', () => {
    expect(() => leggiBozzaEpisodio(JSON.stringify({ versione: 1, kind: 54 }))).toThrow(
      /Non e’ una bozza/,
    )
  })

  it('un allegato senza descrittore: senza, non si puo’ riadottare', () => {
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

describe('completezza', () => {
  const vuota = {
    episodio: { titolo: '', descrizione: '', contenuto: '', hashtag: [] },
    allegati: [],
  }

  it('elenca cosa manca, nell’ordine in cui va colmato', () => {
    expect(completezzaEpisodio(vuota)).toEqual({
      pronta: false,
      manca: ['il titolo', 'la descrizione', 'un file audio su Blossom'],
    })
  })

  it('non conta un’immagine come audio', () => {
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

  it('e’ pronta con titolo, descrizione e un audio', () => {
    expect(
      completezzaEpisodio({
        episodio: { titolo: 'T', descrizione: 'D', contenuto: '', hashtag: [] },
        allegati: [AUDIO],
      }),
    ).toEqual({ pronta: true, manca: [] })
  })
})
