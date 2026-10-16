import { describe, expect, it } from 'vitest'

import {
  audioAdattoAlPodcast,
  estensioneDelNome,
  estensionePer,
  urlConEstensione,
} from '../src/media/extensions.js'

/**
 * The extension in a blob's URL is chosen by the client, not by the server:
 * BUD-01 obliges the server to accept any extension at all when reading, and
 * yakihonne answers `.mpga` for `audio/mpeg` — correct per IANA, unknown to
 * podcast players. Verified live on yakihonne and nostr.download.
 */

const SHA = 'ab'.repeat(32)

describe('the extension for a MIME', () => {
  it('turns audio/mpeg into mp3, not mpga', () => {
    expect(estensionePer('audio/mpeg')).toBe('mp3')
  })

  it("keeps the original name's extension when it is consistent with the MIME", () => {
    expect(estensionePer('image/jpeg', 'foto.JPEG')).toBe('jpeg')
    expect(estensionePer('audio/mp4', 'puntata.m4a')).toBe('m4a')
  })

  it('ignores a name inconsistent with the MIME: a PNG called .mp3 stays png', () => {
    expect(estensionePer('image/png', 'strano.mp3')).toBe('png')
  })

  it('falls back on the name without a known MIME, and invents nothing without a name', () => {
    expect(estensionePer('application/x-sconosciuto', 'dati.xyz')).toBe('xyz')
    expect(estensionePer('application/x-sconosciuto')).toBeNull()
  })

  it('reads the name with a query string too, and without an extension', () => {
    expect(estensioneDelNome('a.mp3?x=1')).toBe('mp3')
    expect(estensioneDelNome('senza')).toBeNull()
    expect(estensioneDelNome('.nascosto')).toBeNull()
  })
})

describe('a Blossom URL', () => {
  it("replaces the server's extension with the chosen one", () => {
    expect(urlConEstensione(`https://b.example/${SHA}.mpga`, 'audio/mpeg')).toBe(
      `https://b.example/${SHA}.mp3`,
    )
  })

  it('adds it when the server puts none', () => {
    expect(urlConEstensione(`https://b.example/${SHA}`, 'image/png')).toBe(
      `https://b.example/${SHA}.png`,
    )
  })

  it('does not touch a URL that does not end in a hash', () => {
    expect(urlConEstensione('https://b.example/upload', 'audio/mpeg')).toBe(
      'https://b.example/upload',
    )
  })

  it('leaves the URL as it is when it does not know which extension to put', () => {
    expect(urlConEstensione(`https://b.example/${SHA}.bin`, 'application/x-boh')).toBe(
      `https://b.example/${SHA}.bin`,
    )
  })
})

describe('audio suitable for a podcast', () => {
  it('accepts mp3 and m4a, refuses wav and ogg', () => {
    expect(audioAdattoAlPodcast('audio/mpeg')).toBe(true)
    expect(audioAdattoAlPodcast('audio/mp4')).toBe(true)
    expect(audioAdattoAlPodcast('audio/wav')).toBe(false)
    expect(audioAdattoAlPodcast('audio/ogg')).toBe(false)
  })
})
