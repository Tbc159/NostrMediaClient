import { describe, expect, it } from 'vitest'

import { CATEGORIE_APPLE, isCategoriaApple } from '../src/podcast/categories.js'
import {
  PIATTAFORME,
  copertinaConforme,
  urlShowSu,
  verificaPiattaforma,
  type Piattaforma,
} from '../src/podcast/platforms.js'

const per = (id: Piattaforma['id']): Piattaforma =>
  PIATTAFORME.find((p) => p.id === id) as Piattaforma

const COMPLETA = {
  description: 'Uno show.',
  image: 'https://b.example/c.png',
  categories: [{ principale: 'News', sotto: 'Daily News' }],
  language: 'it',
  email: 'owner@esempio.tld',
  websites: ['https://esempio.tld', 'https://podcasts.apple.com/it/podcast/x/id1'],
  mimeEpisodi: ['audio/mpeg'],
}
const QUADRATA = { larghezza: 1400, altezza: 1400 }

describe('the Apple categories', () => {
  it('are the 19 official ones, with the right sub-categories', () => {
    expect(Object.keys(CATEGORIE_APPLE)).toHaveLength(19)
    expect(isCategoriaApple({ principale: 'News', sotto: 'Daily News' })).toBe(true)
    expect(isCategoriaApple({ principale: 'True Crime' })).toBe(true)
  })

  it('refuse a sub-category of another main one, and an invented main one', () => {
    expect(isCategoriaApple({ principale: 'News', sotto: 'Improv' })).toBe(false)
    expect(isCategoriaApple({ principale: 'Podcast' })).toBe(false)
  })
})

describe('the cover', () => {
  it('is only acceptable square, between 1400 and 3000', () => {
    expect(copertinaConforme(QUADRATA)).toBe(true)
    expect(copertinaConforme({ larghezza: 640, altezza: 426 })).toBe(false)
    expect(copertinaConforme({ larghezza: 1000, altezza: 1000 })).toBe(false)
    expect(copertinaConforme({ larghezza: 3001, altezza: 3001 })).toBe(false)
    expect(copertinaConforme(null)).toBe(false)
  })
})

describe('the checklist per platform', () => {
  it('finds a complete card ready everywhere', () => {
    for (const p of PIATTAFORME) {
      expect(verificaPiattaforma(p, COMPLETA, QUADRATA).pronta, p.nome).toBe(true)
    }
  })

  it('knows Apple does not ask for the email and Spotify does: the same datum is missing only where it matters', () => {
    const senzaEmail = { ...COMPLETA, email: undefined }
    expect(verificaPiattaforma(per('apple'), senzaEmail, QUADRATA).pronta).toBe(true)
    const spotify = verificaPiattaforma(per('spotify'), senzaEmail, QUADRATA)
    expect(spotify.pronta).toBe(false)
    expect(spotify.voci.find((v) => v.requisito === 'email')?.testo).toMatch(/email/)
  })

  it("explains today's 640×426 cover instead of merely failing it", () => {
    const esito = verificaPiattaforma(per('apple'), COMPLETA, { larghezza: 640, altezza: 426 })
    const voce = esito.voci.find((v) => v.requisito === 'copertina-quadrata')
    expect(voce?.ok).toBe(false)
    expect(voce?.testo).toMatch(/640×426.*non è quadrata/)
  })

  it('has a wav episode trip the mp3/m4a requirement', () => {
    const esito = verificaPiattaforma(
      per('apple'),
      { ...COMPLETA, mimeEpisodi: ['audio/mpeg', 'audio/wav'] },
      QUADRATA,
    )
    expect(esito.voci.find((v) => v.requisito === 'episodio-mp3')?.testo).toMatch(/audio\/wav/)
  })

  it("finds the show's link among the websites, by domain", () => {
    expect(urlShowSu(per('apple'), COMPLETA.websites)).toMatch(/podcasts\.apple\.com/)
    expect(urlShowSu(per('spotify'), COMPLETA.websites)).toBeNull()
    expect(verificaPiattaforma(per('apple'), COMPLETA, QUADRATA).urlShow).toMatch(/apple/)
  })

  it('asks Podcast Index for a valid feed alone', () => {
    const minima = { description: 'x' }
    expect(verificaPiattaforma(per('podcastindex'), minima, null).pronta).toBe(true)
  })
})
