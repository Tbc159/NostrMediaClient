import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  attendiLavoro,
  codecDaNome,
  creaServizioAudioLegacy,
  nomeLivellato,
  strategiaSilenzi,
  type ServizioAudio,
} from '../src/audio/index.js'
import { ErroreServizio } from '../src/servizi/http.js'
import { avviaAudioFinto, type AudioFinto } from './helpers/audio-finto.js'

/**
 * Pre-elaborazione audio contro un servizio che si comporta come quello vero.
 *
 * Le prove che contano non sono «la chiamata risponde 200», ma le due
 * conseguenze delle cartelle del servizio: l'ordine delle operazioni non e'
 * libero, e non tutti i formati ammettono il taglio dei silenzi.
 */

const SILENZI = { soglia: '-40dB', durataMinimaS: 1 }
/** Nei test l'orologio non deve scorrere davvero. */
const SUBITO = { intervalloMs: 1, attendi: () => Promise.resolve() }

let finto: AudioFinto
let servizio: ServizioAudio

const audio = (): Blob => new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' })

beforeAll(async () => {
  finto = await avviaAudioFinto()
  servizio = creaServizioAudioLegacy({ baseUrl: finto.url, timeoutMs: 5000 })
})

beforeEach(() => {
  finto.archivio.clear()
  finto.richieste.length = 0
  finto.giriPrimaDelFine = 1
  finto.faiFallire = false
})

afterAll(async () => {
  await finto.chiudi()
})

describe('quale formato ammette cosa', () => {
  it('dice in anticipo se il taglio dei silenzi e' + "' possibile", () => {
    // Non e' una scelta nostra: `remove_silence` legge dalla cartella degli
    // mp3. Saperlo prima evita di proporre un'operazione che fallira'.
    expect(strategiaSilenzi('mp3')).toBe('diretta')
    expect(strategiaSilenzi('m4a')).toBe('conversione')
    expect(strategiaSilenzi('wav')).toBe('non-disponibile')
  })

  it('riconosce il codec dal nome, e rifiuta cio' + "' che non e' audio", () => {
    expect(codecDaNome('Puntata 12.MP3')).toBe('mp3')
    expect(codecDaNome('registrazione.m4a')).toBe('m4a')
    expect(codecDaNome('copertina.png')).toBeNull()
  })
})

describe('caricamento', () => {
  it('corregge l' + "'estensione perche' il servizio la confronta col codec", async () => {
    // Il servizio risponde 400 se estensione e codec non coincidono: meglio
    // sistemare qui che farsi rifiutare.
    const nome = await servizio.carica(audio(), 'senza-estensione', 'mp3')
    expect(nome).toBe('senza-estensione.mp3')
    expect(finto.archivio.get(nome)).toBe('mp3_media')
  })

  it('rifiuta un codec che il servizio non conosce', async () => {
    await expect(servizio.carica(audio(), 'x.ogg', 'ogg' as unknown as 'mp3')).rejects.toThrow()
  })
})

describe('l’ordine delle operazioni non e' + "' libero", () => {
  it('silenzi e poi livellamento: funziona', async () => {
    const nome = await servizio.carica(audio(), 'puntata.mp3', 'mp3')
    await servizio.togliSilenzi(nome, SILENZI)
    const lavoro = await servizio.livella(nome, 'mp3')
    const prodotto = await attendiLavoro(servizio, lavoro, SUBITO)

    expect(prodotto).toBe('puntata_normalized.mp3')
    const byte = new Uint8Array(await (await servizio.scarica(prodotto)).arrayBuffer())
    expect([...byte.slice(0, 3)]).toEqual([0x49, 0x44, 0x33])
  })

  it('livellamento e poi silenzi: il servizio non trova piu' + "' il file", async () => {
    // E' il difetto vero del servizio: `normalize` scrive in `normalized/`
    // mentre `remove_silence` guarda in `mp3_media/`. Quasi certamente il
    // motivo per cui nello script originale quel passaggio e' commentato.
    const nome = await servizio.carica(audio(), 'puntata.mp3', 'mp3')
    const lavoro = await servizio.livella(nome, 'mp3')
    const livellato = await attendiLavoro(servizio, lavoro, SUBITO)

    await expect(servizio.togliSilenzi(livellato, SILENZI)).rejects.toThrow(/cartella degli mp3/)
  })

  it('un m4a passa dalla conversione prima di poter perdere i silenzi', async () => {
    const nome = await servizio.carica(audio(), 'puntata.m4a', 'm4a')
    await expect(servizio.togliSilenzi(nome, SILENZI)).rejects.toThrow(/mp3/)

    const lavoro = await servizio.convertiInMp3(nome)
    const convertito = await attendiLavoro(servizio, lavoro, SUBITO)
    expect(convertito).toBe('puntata.mp3')

    await expect(servizio.togliSilenzi(convertito, SILENZI)).resolves.toBe(convertito)
  })
})

describe('parametri mandati al servizio', () => {
  it('manda soglia e durata scelte da noi, non i default del servizio', async () => {
    // Il default del servizio e' -90dB, con cui non viene tolto quasi nulla.
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    await servizio.togliSilenzi(nome, { soglia: '-40dB', durataMinimaS: 1 })

    const inviata = finto.richieste.find((r) => r.percorso === '/media/remove_silence')
    expect(inviata?.corpo).toMatchObject({ silence_level: '-40dB', seconds_silence: 1 })
  })

  it('per il livellamento passa un URL, non un nome', async () => {
    // Con il solo nome il servizio cercherebbe in una cartella sola; con un
    // URL verso /voice/download cerca ovunque e lo trova.
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    await servizio.livella(nome, 'mp3')

    const inviata = finto.richieste.find((r) => r.percorso === '/media/normalize')
    expect(String((inviata?.corpo as { source_file: string }).source_file)).toMatch(
      /\/voice\/download\/p\.mp3$/,
    )
  })

  it('sa prevedere il nome del risultato, per riconoscerlo', () => {
    expect(nomeLivellato('puntata 12.mp3', 'mp3')).toBe('puntata 12_normalized.mp3')
  })
})

describe('attesa del lavoro', () => {
  it('riporta l' + "'avanzamento a ogni giro", async () => {
    finto.giriPrimaDelFine = 3
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    const lavoro = await servizio.livella(nome, 'mp3')

    const visti: string[] = []
    await attendiLavoro(servizio, lavoro, { ...SUBITO, onStato: (s) => visti.push(s.stato) })

    expect(visti).toEqual(['in-corso', 'in-corso', 'completato'])
  })

  it('un lavoro fallito diventa un errore, non un file mancante', async () => {
    finto.faiFallire = true
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    const lavoro = await servizio.livella(nome, 'mp3')

    await expect(attendiLavoro(servizio, lavoro, SUBITO)).rejects.toThrow(/non e’ riuscita/)
  })

  it('smette di aspettare, e non promette di aver annullato nulla', async () => {
    finto.giriPrimaDelFine = 1000
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    const lavoro = await servizio.livella(nome, 'mp3')

    await expect(attendiLavoro(servizio, lavoro, { ...SUBITO, scadenzaMs: 5 })).rejects.toThrow(
      /ancora in corso sul servizio/,
    )
  })

  it('si puo' + "' interrompere da fuori", async () => {
    finto.giriPrimaDelFine = 1000
    const nome = await servizio.carica(audio(), 'p.mp3', 'mp3')
    const lavoro = await servizio.livella(nome, 'mp3')

    const taglio = new AbortController()
    taglio.abort()
    await expect(
      attendiLavoro(servizio, lavoro, { ...SUBITO, segnale: taglio.signal }),
    ).rejects.toThrow(/interrotta/)
  })
})

describe('quando il servizio non c’e' + "'", () => {
  it('lo dice senza far credere che sia colpa della rete', async () => {
    const spento = creaServizioAudioLegacy({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 })
    expect(await spento.disponibile()).toBe(false)
    await expect(spento.carica(audio(), 'p.mp3', 'mp3')).rejects.toThrow(/CORS|contenuto misto/)
  })

  it('il servizio raggiungibile risulta disponibile anche senza health check', async () => {
    // Quello vero non ne ha uno: si interroga un lavoro inesistente, che
    // risponde 404 senza modificare niente.
    expect(await servizio.disponibile()).toBe(true)
  })

  it('porta lo stato HTTP nell' + "'errore", async () => {
    await expect(servizio.scarica('inesistente.mp3')).rejects.toSatisfy(
      (e: unknown) => e instanceof ErroreServizio && e.stato === 404,
    )
  })
})
