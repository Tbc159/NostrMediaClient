import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ErroreMediaManager,
  creaClientMediaManager,
  portaSulServizio,
  scaricaGenerata,
  tipoAccettato,
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

  it('la salute non richiede chiave: serve a capire se il servizio e' + " c'e'", async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    expect(await anonimo.salute('media')).toBe(true)
    expect(await anonimo.salute('content')).toBe(true)
  })
})

describe('generazione di un’immagine', () => {
  it('compone una copertina e restituisce gli indirizzi dei byte', async () => {
    await client.caricaMedia(
      new Blob([new Uint8Array([9])], { type: 'image/png' }),
      'host.png',
      'image/png',
    )

    const immagine = await client.generaImmagine({
      tipo: 'copertina',
      titolo: 'Prova',
      testo_centrale: 'ospita',
      logo_host: 'host.png',
    })

    expect(immagine.tipo).toBe('copertina')
    expect(immagine.content_url).toMatch(/^\/v0\/media\/\d+\/content$/)
    // Gli URL del servizio sono relativi: usarli cosi' com'e' da un'altra
    // origine porterebbe sulla nostra, non sulla sua.
    expect(client.urlAssoluto(immagine.content_url)).toBe(`${servizio.url}${immagine.content_url}`)
  })

  it('accetta il motore a livelli', async () => {
    const immagine = await client.generaImmagine({
      tipo: 'composita',
      layers: [
        { type: 'background', fallback_color: '#101010' },
        { type: 'text', content: 'RASSEGNA\nSTAMPA', font_size: 90, x: 'center', y: '20%' },
      ],
    })
    expect(immagine.tipo).toBe('composita')
  })

  it(
    'dice che il generatore social non e' + "' ancora realizzato, invece di «errore»",
    async () => {
      // 501 non e' un guasto: e' una funzione dichiarata nel contratto e non
      // ancora scritta. Confonderla con un errore manderebbe a cercare un
      // problema che non c'e'.
      await expect(
        client.generaImmagine({ tipo: 'social', logo_top: 1, logo_bottom: 2 }),
      ).rejects.toThrow(/non ancora realizzata/)
    },
  )

  it('segnala un asset che il servizio non conosce', async () => {
    await expect(
      client.generaImmagine({
        tipo: 'copertina',
        titolo: 'x',
        testo_centrale: 'y',
        logo_host: 'inesistente.png',
      }),
    ).rejects.toThrow(/asset/)
  })
})

describe('ponte da e verso Blossom', () => {
  it('traduce i tipi che il contratto non nomina ma sono la stessa cosa', () => {
    expect(tipoAccettato('audio/mpeg')).toBe('audio/mp3')
    expect(tipoAccettato('image/jpg')).toBe('image/jpeg')
    expect(tipoAccettato('image/png; charset=binary')).toBe('image/png')
  })

  it('rifiuta in anticipo i tipi che il servizio non accetta', () => {
    // Meglio fermarsi qui che mandare un upload destinato a un 400: il
    // contratto non prevede ne' i font ne' i wav, e serve dirlo.
    expect(tipoAccettato('font/ttf')).toBeNull()
    expect(tipoAccettato('audio/wav')).toBeNull()
  })

  it('un file gia' + " presente non e' un errore: si riusa quello", async () => {
    const blob = new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' })
    const primo = await portaSulServizio(client, { blob, titolo: 'ripetuto.png' })
    expect(primo.giaPresente).toBe(false)

    const secondo = await portaSulServizio(client, { blob, titolo: 'ripetuto.png' })
    expect(secondo.giaPresente).toBe(true)
    expect(secondo.media.id).toBe(primo.media.id)
  })

  it('scarica i byte dell' + "'immagine generata, per rimandarli su Blossom", async () => {
    const immagine = await client.generaImmagine({
      tipo: 'composita',
      layers: [{ type: 'background', fallback_color: '#000000' }],
    })
    const blob = await scaricaGenerata(client, immagine)
    const byte = new Uint8Array(await blob.arrayBuffer())
    expect([...byte.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('i byte del servizio sono dietro la chiave: un <img src> diretto darebbe 401', async () => {
    // Non e' un dettaglio: e' il motivo per cui l'anteprima si costruisce
    // scaricando i byte, invece di puntare l'immagine al servizio.
    const immagine = await client.generaImmagine({
      tipo: 'composita',
      layers: [{ type: 'background', fallback_color: '#000000' }],
    })
    const risposta = await fetch(client.urlAssoluto(immagine.content_url))
    expect(risposta.status).toBe(401)
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
    expect(spiegaStato(501)).toMatch(/non ancora realizzata/)
    expect(spiegaStato(503)).toMatch(/non risponde/)
  })

  it('porta lo stato HTTP nell' + "'errore, per chi deve distinguerlo", async () => {
    const anonimo = creaClientMediaManager({ baseUrl: servizio.url })
    await expect(anonimo.elencoMedia('image/png')).rejects.toSatisfy(
      (e: unknown) => e instanceof ErroreMediaManager && e.stato === 401,
    )
  })
})
