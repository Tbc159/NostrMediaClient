import { describe, expect, it } from 'vitest'

import { scaricaImmagine, titoloPerUrl } from '../src/media/download.js'

/**
 * The two roads to reading an image from a URL: the direct one, and the service
 * when the image's server does not allow reading from a page. The fake `fetch`
 * reproduces the browser: a server without CORS does not answer with an HTTP
 * error, it *throws* — and that is the case to be covered.
 */

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

const fetchConCors: typeof fetch = async () => new Response(PNG, { status: 200 })
const fetchSenzaCors: typeof fetch = async () => {
  throw new TypeError('NetworkError when attempting to fetch resource.')
}

function servizioFinto(esito: 'ok' | 'rifiuta') {
  const chiamate: string[] = []
  return {
    chiamate,
    async caricaMediaDaUrl(url: string, titolo: string) {
      chiamate.push(`from-url ${url} ${titolo}`)
      if (esito === 'rifiuta') throw new Error('URL non consentito: host privato')
      return {
        id: 7,
        title: titolo,
        filename: 'arc-7.png',
        media_type: 'image/png',
        content_url: '/v0/media/7/content',
      }
    },
    async scaricaContenuto(percorso: string) {
      chiamate.push(`content ${percorso}`)
      return PNG
    },
  }
}

describe('scaricaImmagine', () => {
  it('reads directly with CORS and does not touch the service', async () => {
    const servizio = servizioFinto('ok')
    const r = await scaricaImmagine('https://blossom.esempio/abc.png', {
      fetch: fetchConCors,
      mediaManager: servizio,
    })
    expect(r.via).toBe('diretta')
    expect(r.blob.type).toBe('image/png')
    expect(servizio.chiamate).toEqual([])
  })

  it('goes through the service without CORS, with a stable title so the 409 can be reused', async () => {
    const servizio = servizioFinto('ok')
    const r = await scaricaImmagine('https://sito.esempio/foto.jpg', {
      fetch: fetchSenzaCors,
      mediaManager: servizio,
    })
    expect(r.via).toBe('servizio')
    const titolo = await titoloPerUrl('https://sito.esempio/foto.jpg')
    expect(titolo).toMatch(/^immagine-da-url-[0-9a-f]{16}$/)
    expect(servizio.chiamate).toEqual([
      `from-url https://sito.esempio/foto.jpg ${titolo}`,
      'content /v0/media/7/content',
    ])
  })

  it('says the service is missing when there is no CORS and no service', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/foto.jpg', { fetch: fetchSenzaCors }),
    ).rejects.toThrow(/non c’è un servizio configurato/)
  })

  it('carries both causes in the error when the service fails too', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/foto.jpg', {
        fetch: fetchSenzaCors,
        mediaManager: servizioFinto('rifiuta'),
      }),
    ).rejects.toThrow(/NetworkError.*nemmeno il servizio.*host privato/)
  })

  it('tries the service anyway on a direct 404, which is not a CORS problem', async () => {
    const servizio = servizioFinto('ok')
    const r = await scaricaImmagine('https://sito.esempio/sparita.jpg', {
      fetch: async () => new Response('no', { status: 404 }),
      mediaManager: servizio,
    })
    expect(r.via).toBe('servizio')
  })

  it('refuses a response that is not an image', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/pagina', {
        fetch: async () =>
          new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow(/non è un'immagine \(text\/html\)/)
  })
})
