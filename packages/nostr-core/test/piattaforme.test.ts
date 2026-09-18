import { describe, expect, it } from 'vitest'

import { CATEGORIE_APPLE, isCategoriaApple } from '../src/podcast/categorie.js'
import {
  PIATTAFORME,
  copertinaConforme,
  urlShowSu,
  verificaPiattaforma,
  type Piattaforma,
} from '../src/podcast/piattaforme.js'

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

describe('categorie Apple', () => {
  it('sono le 19 ufficiali, con le sotto-categorie giuste', () => {
    expect(Object.keys(CATEGORIE_APPLE)).toHaveLength(19)
    expect(isCategoriaApple({ principale: 'News', sotto: 'Daily News' })).toBe(true)
    expect(isCategoriaApple({ principale: 'True Crime' })).toBe(true)
  })

  it('rifiuta una sotto-categoria di un’altra principale, e una principale inventata', () => {
    expect(isCategoriaApple({ principale: 'News', sotto: 'Improv' })).toBe(false)
    expect(isCategoriaApple({ principale: 'Podcast' })).toBe(false)
  })
})

describe('copertina', () => {
  it('va bene solo quadrata fra 1400 e 3000', () => {
    expect(copertinaConforme(QUADRATA)).toBe(true)
    expect(copertinaConforme({ larghezza: 640, altezza: 426 })).toBe(false)
    expect(copertinaConforme({ larghezza: 1000, altezza: 1000 })).toBe(false)
    expect(copertinaConforme({ larghezza: 3001, altezza: 3001 })).toBe(false)
    expect(copertinaConforme(null)).toBe(false)
  })
})

describe('checklist per piattaforma', () => {
  it('una scheda completa e’ pronta ovunque', () => {
    for (const p of PIATTAFORME) {
      expect(verificaPiattaforma(p, COMPLETA, QUADRATA).pronta, p.nome).toBe(true)
    }
  })

  it('Apple non chiede l’email, Spotify si’: lo stesso dato manca solo dove serve', () => {
    const senzaEmail = { ...COMPLETA, email: undefined }
    expect(verificaPiattaforma(per('apple'), senzaEmail, QUADRATA).pronta).toBe(true)
    const spotify = verificaPiattaforma(per('spotify'), senzaEmail, QUADRATA)
    expect(spotify.pronta).toBe(false)
    expect(spotify.voci.find((v) => v.requisito === 'email')?.testo).toMatch(/email/)
  })

  it('la copertina 640×426 di oggi viene spiegata, non solo bocciata', () => {
    const esito = verificaPiattaforma(per('apple'), COMPLETA, { larghezza: 640, altezza: 426 })
    const voce = esito.voci.find((v) => v.requisito === 'copertina-quadrata')
    expect(voce?.ok).toBe(false)
    expect(voce?.testo).toMatch(/640×426.*non e’ quadrata/)
  })

  it('un episodio wav fa scattare il requisito mp3/m4a', () => {
    const esito = verificaPiattaforma(
      per('apple'),
      { ...COMPLETA, mimeEpisodi: ['audio/mpeg', 'audio/wav'] },
      QUADRATA,
    )
    expect(esito.voci.find((v) => v.requisito === 'episodio-mp3')?.testo).toMatch(/audio\/wav/)
  })

  it('trova il link dello show fra i siti, per dominio', () => {
    expect(urlShowSu(per('apple'), COMPLETA.websites)).toMatch(/podcasts\.apple\.com/)
    expect(urlShowSu(per('spotify'), COMPLETA.websites)).toBeNull()
    expect(verificaPiattaforma(per('apple'), COMPLETA, QUADRATA).urlShow).toMatch(/apple/)
  })

  it('Podcast Index chiede solo un feed valido', () => {
    const minima = { description: 'x' }
    expect(verificaPiattaforma(per('podcastindex'), minima, null).pronta).toBe(true)
  })
})
