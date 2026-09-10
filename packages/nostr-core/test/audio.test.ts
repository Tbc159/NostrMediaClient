import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  attendiLavoro,
  creaServizioAudio,
  estensioneDi,
  formatoDaNome,
  type ServizioAudio,
} from '../src/audio/index.js'
import { ErroreServizio } from '../src/servizi/http.js'
import {
  CHIAVE_DI_PROVA,
  avviaMediaManagerFinto,
  type MediaManagerFinto,
} from './helpers/mediamanager-finto.js'

/**
 * Elaborazione audio contro un servizio che si comporta come quello vero.
 *
 * Cio' che va provato non e' «la chiamata risponde 200» ma le proprieta' su
 * cui la pagina si appoggia e che prima non c'erano: l'ordine e' libero, i
 * formati sono indifferenti, la sorgente sopravvive alle lavorazioni, e il
 * riferimento e' il `filename` — non il titolo che abbiamo mandato noi.
 */

const SILENZI = { sogliaDb: -40, pausaMinimaS: 1 }
/** Nei test l'orologio non deve scorrere davvero. */
const SUBITO = { intervalloMs: 1, attendi: () => Promise.resolve() }

let finto: MediaManagerFinto
let servizio: ServizioAudio

const audio = (tipo = 'audio/mpeg'): Blob => new Blob([new Uint8Array(2048)], { type: tipo })

beforeAll(async () => {
  finto = await avviaMediaManagerFinto()
  servizio = creaServizioAudio({ baseUrl: finto.url, apiKey: CHIAVE_DI_PROVA, timeoutMs: 5000 })
})

beforeEach(() => {
  finto.media.length = 0
  finto.richiesteAudio.length = 0
  finto.giriPrimaDelFine = 1
  finto.faiFallire = false
})

afterAll(async () => {
  await finto.chiudi()
})

describe('formati', () => {
  it('riconosce il formato dal nome e usa il tipo MIME registrato', () => {
    // `audio/mp3` non e' un tipo registrato: il servizio lo accetta come alias
    // ma non c'e' ragione di propagare un nome sbagliato.
    expect(formatoDaNome('Puntata 12.MP3')).toBe('audio/mpeg')
    expect(formatoDaNome('registrazione.m4a')).toBe('audio/m4a')
    expect(formatoDaNome('grezzo.wav')).toBe('audio/wav')
    expect(formatoDaNome('copertina.png')).toBeNull()
  })

  it('ricava l’estensione dal formato', () => {
    expect(estensioneDi('audio/mpeg')).toBe('mp3')
    expect(estensioneDi('audio/wav')).toBe('wav')
  })
})

describe('caricamento e riferimenti', () => {
  it('il riferimento e’ il filename generato dal servizio, non il titolo', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 12.mp3', 'audio/mpeg')

    // La distinzione non e' teorica: e' il difetto che il client aveva.
    expect(caricato.filename).not.toBe(caricato.title)
    await expect(servizio.avviaSilenzi(caricato.filename, SILENZI)).resolves.toBeTruthy()
  })

  it('riferirsi per titolo fallisce, e l’errore dice come ha cercato', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 13.mp3', 'audio/mpeg')

    await expect(servizio.avviaSilenzi(caricato.title, SILENZI)).rejects.toThrow(
      /asset non trovato/,
    )
  })
})

describe('lo stesso file, due volte', () => {
  it('non e' + "' un errore: si riusa il record che c'e' gia'", async () => {
    // Rielaborare la stessa registrazione e' normale — un'altra soglia, il
    // giorno dopo — e il servizio risponde 409. Trattarlo come guasto
    // fermerebbe il flusso proprio nel caso piu' frequente.
    const primo = await servizio.carica(audio(), 'Puntata 12 bis.mp3', 'audio/mpeg')
    const secondo = await servizio.carica(audio(), 'Puntata 12 bis.mp3', 'audio/mpeg')

    expect(secondo.id).toBe(primo.id)
    expect(secondo.filename).toBe(primo.filename)
  })
})

describe('le lavorazioni', () => {
  it('accorcia i silenzi passando i parametri che l’utente ha scelto', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 14.mp3', 'audio/mpeg')
    const lavoro = await servizio.avviaSilenzi(caricato.filename, {
      sogliaDb: -33,
      pausaMinimaS: 1.5,
      silenzioDaLasciareS: 0.3,
    })
    await attendiLavoro(servizio, lavoro, SUBITO)

    const inviato = finto.richiesteAudio.at(-1)
    expect(inviato?.percorso).toBe('/v0/audio/silence')
    // La soglia viaggia come numero: l'unita' la mette il servizio. Prima
    // andava composta qui, e ometterla voleva dire non tagliare nulla.
    expect(inviato?.corpo).toMatchObject({
      threshold_db: -33,
      min_pause_s: 1.5,
      keep_silence_s: 0.3,
    })
  })

  it('non distrugge la sorgente: si puo’ ritentare con una soglia diversa', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 15.mp3', 'audio/mpeg')

    const primo = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(caricato.filename, { sogliaDb: -50, pausaMinimaS: 1 }),
      SUBITO,
    )
    // Stessa sorgente, un'altra soglia, senza ricaricare il file: e' l'azione
    // piu' naturale davanti a un cursore, e col servizio vecchio era
    // impossibile.
    const secondo = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(caricato.filename, { sogliaDb: -30, pausaMinimaS: 1 }),
      SUBITO,
    )

    expect(primo[0]?.id).not.toBe(secondo[0]?.id)
  })

  it('l’ordine e’ libero: livellare per primo non spezza la catena', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 16.mp3', 'audio/mpeg')

    const livellato = await attendiLavoro(
      servizio,
      await servizio.avviaLivellamento(caricato.filename),
      SUBITO,
    )
    const poiSilenzi = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(livellato[0]?.id as number, SILENZI),
      SUBITO,
    )

    expect(poiSilenzi[0]?.id).toBeGreaterThan(0)
  })

  it('i formati sono indifferenti: anche un wav passa dai silenzi', async () => {
    const caricato = await servizio.carica(audio('audio/wav'), 'Grezzo.wav', 'audio/wav')

    // Col servizio vecchio l'operazione era semplicemente indisponibile per i
    // wav, e la pagina doveva disattivarla.
    await expect(
      attendiLavoro(servizio, await servizio.avviaSilenzi(caricato.filename, SILENZI), SUBITO),
    ).resolves.toHaveLength(1)
  })

  it('converte in un altro formato', async () => {
    const caricato = await servizio.carica(audio('audio/m4a'), 'Ospite.m4a', 'audio/m4a')
    const prodotti = await attendiLavoro(
      servizio,
      await servizio.avviaConversione(caricato.filename, 'audio/mpeg'),
      SUBITO,
    )

    expect(prodotti[0]?.media_type).toBe('audio/mpeg')
  })
})

describe('attesa del lavoro', () => {
  it('segue gli stati fino alla fine e riporta l’avanzamento', async () => {
    finto.giriPrimaDelFine = 3
    const caricato = await servizio.carica(audio(), 'Puntata 17.mp3', 'audio/mpeg')

    const visti: string[] = []
    const prodotti = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(caricato.filename, SILENZI),
      { ...SUBITO, onStato: (s) => visti.push(s.stato) },
    )

    expect(visti).toContain('in-coda')
    expect(visti).toContain('in-corso')
    expect(prodotti[0]?.id).toBeGreaterThan(0)
  })

  it('un lavoro fallito diventa un errore leggibile, non un’attesa infinita', async () => {
    finto.faiFallire = true
    const caricato = await servizio.carica(audio(), 'Puntata 18.mp3', 'audio/mpeg')

    await expect(
      attendiLavoro(servizio, await servizio.avviaSilenzi(caricato.filename, SILENZI), SUBITO),
    ).rejects.toThrow(/ffmpeg/)
  })

  it('si puo’ smettere di aspettare senza fermare il lavoro sul servizio', async () => {
    finto.giriPrimaDelFine = 99
    const caricato = await servizio.carica(audio(), 'Puntata 19.mp3', 'audio/mpeg')
    const lavoro = await servizio.avviaSilenzi(caricato.filename, SILENZI)

    const stop = new AbortController()
    const attesa = attendiLavoro(servizio, lavoro, { ...SUBITO, segnale: stop.signal })
    stop.abort()
    await expect(attesa).rejects.toThrow(/interrotta/)

    // Il lavoro resta interrogabile: e' persistente, e riprenderlo e' lecito.
    await expect(servizio.stato(lavoro)).resolves.toMatchObject({ stato: 'in-corso' })
  })

  it('smette di aspettare a scadenza, senza promettere di aver annullato', async () => {
    finto.giriPrimaDelFine = 99
    const caricato = await servizio.carica(audio(), 'Puntata 20.mp3', 'audio/mpeg')

    await expect(
      attendiLavoro(servizio, await servizio.avviaSilenzi(caricato.filename, SILENZI), {
        ...SUBITO,
        scadenzaMs: 5,
        adesso: (() => {
          let t = 0
          return () => (t += 10)
        })(),
      }),
    ).rejects.toThrow(/ancora in corso/)
  })

  it('un lavoro che il servizio non conosce non e’ «in corso»', async () => {
    await expect(servizio.stato('inventato-1')).rejects.toThrow(/non conosce/)
  })
})

describe('quando il servizio non c’e’', () => {
  it('lo dice invece di restare in attesa', async () => {
    const spento = creaServizioAudio({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 })
    await expect(spento.disponibile()).resolves.toBe(false)
    await expect(spento.carica(audio(), 'x.mp3', 'audio/mpeg')).rejects.toBeInstanceOf(
      ErroreServizio,
    )
  })
})
