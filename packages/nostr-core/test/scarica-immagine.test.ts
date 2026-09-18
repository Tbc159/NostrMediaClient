import { describe, expect, it } from 'vitest'

import { scaricaImmagine, titoloPerUrl } from '../src/media/scarica.js'

/**
 * Le due strade per leggere un'immagine da un URL: la diretta, e il servizio
 * quando il server dell'immagine non consente la lettura da pagina. Il
 * `fetch` finto riproduce il browser: un server senza CORS non risponde con
 * un errore HTTP, *lancia* — e' quel caso che va coperto.
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
  it('con CORS legge direttamente e non tocca il servizio', async () => {
    const servizio = servizioFinto('ok')
    const r = await scaricaImmagine('https://blossom.esempio/abc.png', {
      fetch: fetchConCors,
      mediaManager: servizio,
    })
    expect(r.via).toBe('diretta')
    expect(r.blob.type).toBe('image/png')
    expect(servizio.chiamate).toEqual([])
  })

  it('senza CORS passa dal servizio, con un titolo stabile per riusare il 409', async () => {
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

  it('senza CORS e senza servizio dice che manca il servizio', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/foto.jpg', { fetch: fetchSenzaCors }),
    ).rejects.toThrow(/non c'e' un servizio configurato/)
  })

  it('se fallisce anche il servizio, l’errore porta entrambe le cause', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/foto.jpg', {
        fetch: fetchSenzaCors,
        mediaManager: servizioFinto('rifiuta'),
      }),
    ).rejects.toThrow(/NetworkError.*nemmeno il servizio.*host privato/)
  })

  it('un 404 diretto non e’ un problema di CORS ma si tenta comunque il servizio', async () => {
    const servizio = servizioFinto('ok')
    const r = await scaricaImmagine('https://sito.esempio/sparita.jpg', {
      fetch: async () => new Response('no', { status: 404 }),
      mediaManager: servizio,
    })
    expect(r.via).toBe('servizio')
  })

  it('una risposta che non e’ un’immagine viene rifiutata', async () => {
    await expect(
      scaricaImmagine('https://sito.esempio/pagina', {
        fetch: async () =>
          new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow(/non e' un'immagine \(text\/html\)/)
  })
})
