import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ErroreMediaManager,
  creaClientMediaManager,
  type ClientMediaManager,
} from '../src/mediamanager/index.js'
// Translating the statuses and normalising the address are shared between the
// two service clients: they are tested where they live.
import { normalizzaBaseUrl, spiegaStato } from '../src/services/http.js'
import {
  CHIAVE_DI_PROVA,
  avviaMediaManagerFinto,
  type MediaManagerFinto,
} from './helpers/fake-mediamanager.js'

let servizio: MediaManagerFinto
let client: ClientMediaManager

beforeAll(async () => {
  servizio = await avviaMediaManagerFinto()
  client = creaClientMediaManager({ baseUrl: servizio.url, apiKey: CHIAVE_DI_PROVA })
})

afterAll(async () => {
  await servizio.chiudi()
})

describe("the service's address", () => {
  it('strips the trailing slash and the hand-written /v0', () => {
    // The user pastes whatever is to hand, and often that is a call's full
    // URL: doubling the /v0 would give a 404 with no explanation.
    expect(normalizzaBaseUrl('http://esempio.tld/')).toBe('http://esempio.tld')
    expect(normalizzaBaseUrl('http://esempio.tld/v0')).toBe('http://esempio.tld')
    expect(normalizzaBaseUrl('  http://esempio.tld/v0/  ')).toBe('http://esempio.tld')
  })

  it('refuses an empty address instead of composing requests into the void', () => {
    expect(() => creaClientMediaManager({ baseUrl: '   ' })).toThrow(/mancante/)
  })
})

describe('reading and writing the media', () => {
  it('uploads a file and finds it again in the list', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const creato = await client.caricaMedia(blob, 'logo-prova.png', 'image/png')
    expect(creato.id).toBeGreaterThan(0)

    const elenco = await client.elencoMedia('image/png')
    expect(elenco.items.some((m) => m.title === 'logo-prova.png')).toBe(true)
  })

  it('has the service refuse without a key, and the message says what to do', async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    await expect(anonimo.elencoMedia('image/png')).rejects.toThrow(/Chiave API/)
  })

  it('lists the whole archive, without having to say of what type', async () => {
    // `type` used to be mandatory and the archive could not be browsed:
    // without a filter the service answered 400.
    await client.caricaMedia(
      new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
      'grezzo.wav',
      'audio/wav',
    )
    const tutto = await client.elencoMedia()
    expect(tutto.items.length).toBeGreaterThan(0)
    expect(new Set(tutto.items.map((m) => m.media_type)).size).toBeGreaterThan(0)
  })

  it('needs no key for the health check: it is there to see whether the service is up', async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    expect(await anonimo.salute('media')).toBe(true)
    expect(await anonimo.salute('content')).toBe(true)
    expect(await anonimo.salute('audio')).toBe(true)
  })
})

describe("the archive's bytes", () => {
  it('sit behind the key: a direct <img src> or <audio src> would give a 401', async () => {
    const creato = await client.caricaMedia(
      new Blob([new Uint8Array([9])], { type: 'audio/wav' }),
      'byte-protetti.wav',
      'audio/wav',
    )
    const risposta = await fetch(client.urlAssoluto(creato.content_url as string))
    expect(risposta.status).toBe(401)
  })

  it('downloads them with the key, to listen again or to save them', async () => {
    const creato = await client.caricaMedia(
      new Blob([new Uint8Array([9])], { type: 'audio/wav' }),
      'byte-scaricabili.wav',
      'audio/wav',
    )
    const blob = await client.scaricaContenuto(creato.download_url as string)
    expect(blob.size).toBeGreaterThan(0)
  })
})

describe('the errors the browser makes incomprehensible', () => {
  it('explains the network failure, naming CORS and mixed content', async () => {
    // From the browser a request blocked by CORS fails before there is any
    // response, and the native error does not say why: without this
    // explanation you look for the fault in the network or in the service,
    // which are both perfectly fine.
    const irraggiungibile = creaClientMediaManager({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'x',
      timeoutMs: 2000,
    })
    await expect(irraggiungibile.elencoMedia('image/png')).rejects.toThrow(/CORS|contenuto misto/)
  })

  it('translates the statuses this service actually uses', () => {
    expect(spiegaStato(401)).toMatch(/Chiave API/)
    expect(spiegaStato(409)).toMatch(/gia’ presente/)
    expect(spiegaStato(503)).toMatch(/non risponde/)
  })

  it('carries the HTTP status in the error, for whoever has to tell them apart', async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    await expect(anonimo.elencoMedia('image/png')).rejects.toSatisfy(
      (e: unknown) => e instanceof ErroreMediaManager && e.stato === 401,
    )
  })
})

describe('downloading a URL on the service side', () => {
  it('creates the medium from a URL and reuses the existing one the second time (409)', async () => {
    const primo = await client.caricaMediaDaUrl(
      'https://immagini.esempio.tld/copertina.png',
      'copertina-da-url',
      'image/png',
    )
    expect(primo.id).toBeGreaterThan(0)
    expect(servizio.richieste.at(-1)).toMatchObject({
      from_url: 'https://immagini.esempio.tld/copertina.png',
      title: 'copertina-da-url',
    })

    const secondo = await client.caricaMediaDaUrl(
      'https://immagini.esempio.tld/copertina.png',
      'copertina-da-url',
    )
    expect(secondo.id).toBe(primo.id)
  })

  it('has a non-http URL refused by the service, and the error says so', async () => {
    await expect(client.caricaMediaDaUrl('ftp://x/y.png', 'ftp-prova')).rejects.toThrow(
      /rifiutata|non consentito/,
    )
  })
})
