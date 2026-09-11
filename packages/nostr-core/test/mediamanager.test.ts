import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ErroreMediaManager,
  creaClientMediaManager,
  type ClientMediaManager,
} from '../src/mediamanager/index.js'
// Traduzione degli stati e normalizzazione dell'indirizzo sono condivise fra i
// due client di servizio: si provano dove vivono.
import { normalizzaBaseUrl, spiegaStato } from '../src/servizi/http.js'
import {
  CHIAVE_DI_PROVA,
  avviaMediaManagerFinto,
  type MediaManagerFinto,
} from './helpers/mediamanager-finto.js'

let servizio: MediaManagerFinto
let client: ClientMediaManager

beforeAll(async () => {
  servizio = await avviaMediaManagerFinto()
  client = creaClientMediaManager({ baseUrl: servizio.url, apiKey: CHIAVE_DI_PROVA })
})

afterAll(async () => {
  await servizio.chiudi()
})

describe('indirizzo del servizio', () => {
  it('toglie lo slash finale e il /v0 scritto a mano', () => {
    // L'utente incolla quello che ha sotto mano, e spesso e' l'URL completo
    // di una chiamata: raddoppiare il /v0 darebbe 404 senza spiegazioni.
    expect(normalizzaBaseUrl('http://esempio.tld/')).toBe('http://esempio.tld')
    expect(normalizzaBaseUrl('http://esempio.tld/v0')).toBe('http://esempio.tld')
    expect(normalizzaBaseUrl('  http://esempio.tld/v0/  ')).toBe('http://esempio.tld')
  })

  it('rifiuta un indirizzo vuoto invece di comporre richieste verso il nulla', () => {
    expect(() => creaClientMediaManager({ baseUrl: '   ' })).toThrow(/mancante/)
  })
})

describe('lettura e scrittura dei media', () => {
  it('carica un file e lo ritrova in elenco', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const creato = await client.caricaMedia(blob, 'logo-prova.png', 'image/png')
    expect(creato.id).toBeGreaterThan(0)

    const elenco = await client.elencoMedia('image/png')
    expect(elenco.items.some((m) => m.title === 'logo-prova.png')).toBe(true)
  })

  it('senza chiave il servizio rifiuta, e il messaggio dice cosa fare', async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    await expect(anonimo.elencoMedia('image/png')).rejects.toThrow(/Chiave API/)
  })

  it('elenca tutto l’archivio, senza dover dire di che tipo', async () => {
    // Prima `type` era obbligatorio e l'archivio non si poteva sfogliare:
    // senza filtro il servizio rispondeva 400.
    await client.caricaMedia(
      new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
      'grezzo.wav',
      'audio/wav',
    )
    const tutto = await client.elencoMedia()
    expect(tutto.items.length).toBeGreaterThan(0)
    expect(new Set(tutto.items.map((m) => m.media_type)).size).toBeGreaterThan(0)
  })

  it('la salute non richiede chiave: serve a capire se il servizio e' + " c'e'", async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    expect(await anonimo.salute('media')).toBe(true)
    expect(await anonimo.salute('content')).toBe(true)
    expect(await anonimo.salute('audio')).toBe(true)
  })
})

describe('i byte dell’archivio', () => {
  it('sono dietro la chiave: un <img src> o <audio src> diretto darebbe 401', async () => {
    const creato = await client.caricaMedia(
      new Blob([new Uint8Array([9])], { type: 'audio/wav' }),
      'byte-protetti.wav',
      'audio/wav',
    )
    const risposta = await fetch(client.urlAssoluto(creato.content_url as string))
    expect(risposta.status).toBe(401)
  })

  it('con la chiave si scaricano, per riascoltarli o salvarli', async () => {
    const creato = await client.caricaMedia(
      new Blob([new Uint8Array([9])], { type: 'audio/wav' }),
      'byte-scaricabili.wav',
      'audio/wav',
    )
    const blob = await client.scaricaContenuto(creato.download_url as string)
    expect(blob.size).toBeGreaterThan(0)
  })
})

describe('errori che il browser rende incomprensibili', () => {
  it('spiega il fallimento di rete nominando CORS e contenuto misto', async () => {
    // Dal browser una richiesta bloccata da CORS fallisce prima di avere una
    // risposta, e l'errore nativo non dice perche': senza questa spiegazione
    // si cerca il guasto nella rete o nel servizio, che stanno benissimo.
    const irraggiungibile = creaClientMediaManager({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'x',
      timeoutMs: 2000,
    })
    await expect(irraggiungibile.elencoMedia('image/png')).rejects.toThrow(/CORS|contenuto misto/)
  })

  it('traduce gli stati che questo servizio usa davvero', () => {
    expect(spiegaStato(401)).toMatch(/Chiave API/)
    expect(spiegaStato(409)).toMatch(/gia’ presente/)
    expect(spiegaStato(503)).toMatch(/non risponde/)
  })

  it('porta lo stato HTTP nell' + "'errore, per chi deve distinguerlo", async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    await expect(anonimo.elencoMedia('image/png')).rejects.toSatisfy(
      (e: unknown) => e instanceof ErroreMediaManager && e.stato === 401,
    )
  })
})
