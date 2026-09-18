import { describe, expect, it } from 'vitest'

import {
  audioAdattoAlPodcast,
  estensioneDelNome,
  estensionePer,
  urlConEstensione,
} from '../src/media/estensioni.js'

/**
 * L'estensione nell'URL di un blob la sceglie il client, non il server:
 * BUD-01 obbliga il server ad accettare qualunque estensione in lettura, e
 * yakihonne risponde `.mpga` per `audio/mpeg` — corretto per IANA, ignoto ai
 * lettori di podcast. Verificato dal vivo su yakihonne e nostr.download.
 */

const SHA = 'ab'.repeat(32)

describe('estensione per un MIME', () => {
  it('audio/mpeg diventa mp3, non mpga', () => {
    expect(estensionePer('audio/mpeg')).toBe('mp3')
  })

  it('tiene l’estensione del nome originale quando e’ coerente col MIME', () => {
    expect(estensionePer('image/jpeg', 'foto.JPEG')).toBe('jpeg')
    expect(estensionePer('audio/mp4', 'puntata.m4a')).toBe('m4a')
  })

  it('ignora un nome incoerente col MIME: un PNG chiamato .mp3 resta png', () => {
    expect(estensionePer('image/png', 'strano.mp3')).toBe('png')
  })

  it('senza MIME noto si affida al nome, e senza nome non inventa', () => {
    expect(estensionePer('application/x-sconosciuto', 'dati.xyz')).toBe('xyz')
    expect(estensionePer('application/x-sconosciuto')).toBeNull()
  })

  it('legge il nome anche con query e senza estensione', () => {
    expect(estensioneDelNome('a.mp3?x=1')).toBe('mp3')
    expect(estensioneDelNome('senza')).toBeNull()
    expect(estensioneDelNome('.nascosto')).toBeNull()
  })
})

describe('URL Blossom', () => {
  it('sostituisce l’estensione del server con quella scelta', () => {
    expect(urlConEstensione(`https://b.example/${SHA}.mpga`, 'audio/mpeg')).toBe(
      `https://b.example/${SHA}.mp3`,
    )
  })

  it('la aggiunge se il server non ne mette', () => {
    expect(urlConEstensione(`https://b.example/${SHA}`, 'image/png')).toBe(
      `https://b.example/${SHA}.png`,
    )
  })

  it('non tocca un URL che non finisce con un hash', () => {
    expect(urlConEstensione('https://b.example/upload', 'audio/mpeg')).toBe(
      'https://b.example/upload',
    )
  })

  it('lascia l’URL com’e’ quando non sa quale estensione mettere', () => {
    expect(urlConEstensione(`https://b.example/${SHA}.bin`, 'application/x-boh')).toBe(
      `https://b.example/${SHA}.bin`,
    )
  })
})

describe('audio adatto a un podcast', () => {
  it('mp3 e m4a si’, wav e ogg no', () => {
    expect(audioAdattoAlPodcast('audio/mpeg')).toBe(true)
    expect(audioAdattoAlPodcast('audio/mp4')).toBe(true)
    expect(audioAdattoAlPodcast('audio/wav')).toBe(false)
    expect(audioAdattoAlPodcast('audio/ogg')).toBe(false)
  })
})
