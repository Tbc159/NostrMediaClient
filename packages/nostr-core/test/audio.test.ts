import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  attendiLavoro,
  creaServizioAudio,
  estensioneDi,
  formatoDaNome,
  type ServizioAudio,
} from '../src/audio/index.js'
import { ErroreServizio } from '../src/services/http.js'
import {
  CHIAVE_DI_PROVA,
  avviaMediaManagerFinto,
  type MediaManagerFinto,
} from './helpers/fake-mediamanager.js'

/**
 * Audio processing against a service that behaves like the real one.
 *
 * What has to be checked is not «the call answers 200» but the properties the
 * page leans on and that were not there before: the order is free, the formats
 * do not matter, the source survives the processing, and the reference is the
 * `filename` — not the title we sent.
 */

const SILENZI = { sogliaDb: -40, pausaMinimaS: 1 }
/** In the tests the clock must not really run. */
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

describe('the formats', () => {
  it('recognises the format from the name and uses the registered MIME type', () => {
    // `audio/mp3` is not a registered type: the service takes it as an alias,
    // but there is no reason to propagate a wrong name.
    expect(formatoDaNome('Puntata 12.MP3')).toBe('audio/mpeg')
    expect(formatoDaNome('registrazione.m4a')).toBe('audio/m4a')
    expect(formatoDaNome('grezzo.wav')).toBe('audio/wav')
    expect(formatoDaNome('copertina.png')).toBeNull()
  })

  it('derives the extension from the format', () => {
    expect(estensioneDi('audio/mpeg')).toBe('mp3')
    expect(estensioneDi('audio/wav')).toBe('wav')
  })
})

describe('uploading and references', () => {
  it("makes the reference the service's generated filename, not the title", async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 12.mp3', 'audio/mpeg')

    // The distinction is not theoretical: it is the defect the client had.
    expect(caricato.filename).not.toBe(caricato.title)
    await expect(servizio.avviaSilenzi(caricato.filename, SILENZI)).resolves.toBeTruthy()
  })

  it('fails when referring by title, and the error says how it searched', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 13.mp3', 'audio/mpeg')

    await expect(servizio.avviaSilenzi(caricato.title, SILENZI)).rejects.toThrow(
      /asset non trovato/,
    )
  })
})

describe('the same file, twice', () => {
  it('is not an error: the record that is already there gets reused', async () => {
    // Reprocessing the same recording is normal — another threshold, the next
    // day — and the service answers 409. Treating that as a fault would stop
    // the flow in the most frequent case of all.
    const primo = await servizio.carica(audio(), 'Puntata 12 bis.mp3', 'audio/mpeg')
    const secondo = await servizio.carica(audio(), 'Puntata 12 bis.mp3', 'audio/mpeg')

    expect(secondo.id).toBe(primo.id)
    expect(secondo.filename).toBe(primo.filename)
  })
})

describe('the processing jobs', () => {
  it('shortens the silences, passing the parameters the user chose', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 14.mp3', 'audio/mpeg')
    const lavoro = await servizio.avviaSilenzi(caricato.filename, {
      sogliaDb: -33,
      pausaMinimaS: 1.5,
      silenzioDaLasciareS: 0.3,
    })
    await attendiLavoro(servizio, lavoro, SUBITO)

    const inviato = finto.richiesteAudio.at(-1)
    expect(inviato?.percorso).toBe('/v0/audio/silence')
    // The threshold travels as a number: the service adds the unit. It used to
    // have to be composed here, and leaving it out meant cutting nothing.
    expect(inviato?.corpo).toMatchObject({
      threshold_db: -33,
      min_pause_s: 1.5,
      keep_silence_s: 0.3,
    })
  })

  it('does not destroy the source: it can be retried with a different threshold', async () => {
    const caricato = await servizio.carica(audio(), 'Puntata 15.mp3', 'audio/mpeg')

    const primo = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(caricato.filename, { sogliaDb: -50, pausaMinimaS: 1 }),
      SUBITO,
    )
    // The same source, another threshold, without re-uploading the file: it is
    // the most natural thing to do in front of a slider, and with the old
    // service it was impossible.
    const secondo = await attendiLavoro(
      servizio,
      await servizio.avviaSilenzi(caricato.filename, { sogliaDb: -30, pausaMinimaS: 1 }),
      SUBITO,
    )

    expect(primo[0]?.id).not.toBe(secondo[0]?.id)
  })

  it('leaves the order free: levelling first does not break the chain', async () => {
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

  it('does not mind the formats: a wav goes through the silences too', async () => {
    const caricato = await servizio.carica(audio('audio/wav'), 'Grezzo.wav', 'audio/wav')

    // With the old service the operation was simply unavailable for wavs, and
    // the page had to disable it.
    await expect(
      attendiLavoro(servizio, await servizio.avviaSilenzi(caricato.filename, SILENZI), SUBITO),
    ).resolves.toHaveLength(1)
  })

  it('converts to another format', async () => {
    const caricato = await servizio.carica(audio('audio/m4a'), 'Ospite.m4a', 'audio/m4a')
    const prodotti = await attendiLavoro(
      servizio,
      await servizio.avviaConversione(caricato.filename, 'audio/mpeg'),
      SUBITO,
    )

    expect(prodotti[0]?.media_type).toBe('audio/mpeg')
  })
})

describe('waiting for the job', () => {
  it('follows the states to the end and reports the progress', async () => {
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

  it('turns a failed job into a readable error, not an endless wait', async () => {
    finto.faiFallire = true
    const caricato = await servizio.carica(audio(), 'Puntata 18.mp3', 'audio/mpeg')

    await expect(
      attendiLavoro(servizio, await servizio.avviaSilenzi(caricato.filename, SILENZI), SUBITO),
    ).rejects.toThrow(/ffmpeg/)
  })

  it('lets you stop waiting without stopping the job on the service', async () => {
    finto.giriPrimaDelFine = 99
    const caricato = await servizio.carica(audio(), 'Puntata 19.mp3', 'audio/mpeg')
    const lavoro = await servizio.avviaSilenzi(caricato.filename, SILENZI)

    const stop = new AbortController()
    const attesa = attendiLavoro(servizio, lavoro, { ...SUBITO, segnale: stop.signal })
    stop.abort()
    await expect(attesa).rejects.toThrow(/interrotta/)

    // The job stays queryable: it is persistent, and picking it up again is fine.
    await expect(servizio.stato(lavoro)).resolves.toMatchObject({ stato: 'in-corso' })
  })

  it('stops waiting at the deadline, without promising it cancelled anything', async () => {
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

  it('does not call a job the service does not know «in progress»', async () => {
    await expect(servizio.stato('inventato-1')).rejects.toThrow(/non conosce/)
  })
})

describe('when the service is not there', () => {
  it('says so instead of waiting', async () => {
    const spento = creaServizioAudio({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 })
    await expect(spento.disponibile()).resolves.toBe(false)
    await expect(spento.carica(audio(), 'x.mp3', 'audio/mpeg')).rejects.toBeInstanceOf(
      ErroreServizio,
    )
  })
})
