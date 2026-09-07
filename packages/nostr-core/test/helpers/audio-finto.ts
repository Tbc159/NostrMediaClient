import { createServer, type Server } from 'node:http'

/**
 * Servizio audio finto, in-process, fedele alle abitudini di quello vero.
 *
 * Riproduce le due cose che il client deve saper gestire e che nessun mock
 * costruito «a immagine del client» produrrebbe:
 *
 *  - i lavori asincroni (`202` con `job_id`, poi `pending` → `done`/`error`);
 *  - **le cartelle**. Un caricamento `mp3` finisce fra gli mp3; il taglio dei
 *    silenzi legge solo da li'; la normalizzazione scrive altrove. Cosi'
 *    invertire l'ordine delle operazioni fallisce qui come fallirebbe sul
 *    servizio vero, invece di passare e rompersi in produzione.
 */

export interface AudioFinto {
  url: string
  /** Nome del file → cartella in cui si trova, come sul servizio. */
  archivio: Map<string, string>
  /** Richieste ricevute, per verificare cosa e' stato mandato. */
  richieste: { percorso: string; corpo: unknown }[]
  /** Quanti giri di stato prima che un lavoro risulti finito. */
  giriPrimaDelFine: number
  /** Se vero, il prossimo lavoro fallisce. */
  faiFallire: boolean
  chiudi(): Promise<void>
}

export async function avviaAudioFinto(): Promise<AudioFinto> {
  const archivio = new Map<string, string>()
  const richieste: { percorso: string; corpo: unknown }[] = []
  const lavori = new Map<string, { giri: number; risultato?: string; fallito: boolean }>()
  let prossimo = 1

  const finto: Partial<AudioFinto> = { giriPrimaDelFine: 1, faiFallire: false }

  const server: Server = createServer((req, res) => {
    const percorso = new URL(req.url ?? '/', 'http://interno').pathname
    const invia = (stato: number, corpo: unknown): void => {
      res.writeHead(stato, {
        'content-type': 'application/json',
        'access-control-allow-origin': req.headers.origin ?? '*',
      })
      res.end(JSON.stringify(corpo))
    }

    const conCorpo = (fn: (corpo: Record<string, unknown>) => void): void => {
      const pezzi: Buffer[] = []
      req.on('data', (c: Buffer) => pezzi.push(c))
      req.on('end', () => {
        const grezzo = Buffer.concat(pezzi)
        if (req.headers['content-type']?.includes('multipart')) {
          const testo = grezzo.toString('latin1')
          const campo = (n: string): string | undefined =>
            testo.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`))?.[1]
          fn({ nome_file: campo('nome_file'), codec_audio: campo('codec_audio') })
          return
        }
        try {
          fn(JSON.parse(grezzo.toString('utf8')) as Record<string, unknown>)
        } catch {
          invia(400, { error: 'json non valido' })
        }
      })
    }

    // --- caricamento ---------------------------------------------------------
    if (percorso === '/media/upload' && req.method === 'POST') {
      conCorpo((corpo) => {
        const nome = String(corpo.nome_file ?? '')
        const codec = String(corpo.codec_audio ?? '')
        if (!nome || !codec) return invia(400, { error: "Missing 'nome_file' or 'codec_audio'" })
        if (!['mp3', 'm4a', 'wav'].includes(codec)) {
          return invia(400, { error: 'Invalid codec_audio' })
        }
        if (!nome.toLowerCase().endsWith(`.${codec}`)) {
          return invia(400, { error: `File extension does not match the codec_audio ${codec}` })
        }
        archivio.set(nome, `${codec}_media`)
        richieste.push({ percorso, corpo })
        invia(200, { message: 'File uploaded successfully' })
      })
      return
    }

    // --- taglio dei silenzi: legge SOLO dagli mp3 ----------------------------
    if (percorso === '/media/remove_silence' && req.method === 'POST') {
      conCorpo((corpo) => {
        richieste.push({ percorso, corpo })
        const nome = String(corpo.input_file ?? '')
        if (!nome) return invia(400, { error: 'input_file is required.' })
        if (archivio.get(nome) !== 'mp3_media') {
          return invia(404, { error: `Input file does not exist: ${nome}` })
        }
        archivio.set(nome, 'clean')
        invia(200, { message: 'Silence removed successfully!', 'input_file/output': nome })
      })
      return
    }

    // --- conversione e livellamento: lavori asincroni ------------------------
    if (
      (percorso === '/media/m4a_to_mp3' || percorso === '/media/normalize') &&
      req.method === 'POST'
    ) {
      conCorpo((corpo) => {
        richieste.push({ percorso, corpo })
        const id = `lavoro-${prossimo++}`

        if (percorso === '/media/m4a_to_mp3') {
          const nome = String(corpo.input_file ?? '')
          if (archivio.get(nome) !== 'm4a_media') {
            return invia(400, { error: 'input_file non trovato fra gli m4a' })
          }
          const prodotto = nome.replace(/\.m4a$/i, '.mp3')
          archivio.delete(nome)
          archivio.set(prodotto, 'mp3_media')
          lavori.set(id, { giri: 0, risultato: prodotto, fallito: Boolean(finto.faiFallire) })
          return invia(202, { job_id: id, status: 'pending' })
        }

        // normalize: la sorgente arriva come URL verso /voice/download
        const sorgente = String(corpo.source_file ?? '')
        const nome = decodeURIComponent(sorgente.split('/').pop() ?? '')
        if (!archivio.has(nome)) {
          lavori.set(id, { giri: 0, fallito: true })
          return invia(202, { job_id: id, status: 'pending' })
        }
        const codec = String(corpo.codec_audio ?? 'mp3')
        const prodotto = `${nome.replace(/\.[^.]+$/, '')}_normalized.${codec}`
        archivio.set(prodotto, 'normalized')
        lavori.set(id, { giri: 0, risultato: prodotto, fallito: Boolean(finto.faiFallire) })
        invia(202, { job_id: id, status: 'pending' })
      })
      return
    }

    // --- stato del lavoro ----------------------------------------------------
    const statoLavoro = percorso.match(/^\/[^/]+\/job\/(.+)$/)
    if (statoLavoro && req.method === 'GET') {
      const id = decodeURIComponent(statoLavoro[1] as string)
      const lavoro = lavori.get(id)
      if (!lavoro) return invia(404, { error: `Job '${id}' not found` })

      lavoro.giri += 1
      if (lavoro.giri < (finto.giriPrimaDelFine ?? 1)) {
        return invia(200, { job_id: id, status: 'pending', result: null })
      }
      if (lavoro.fallito || !lavoro.risultato) {
        return invia(200, {
          job_id: id,
          status: 'error',
          result: { error: 'elaborazione fallita' },
        })
      }
      invia(200, {
        job_id: id,
        status: 'done',
        result: {
          output_file: lavoro.risultato,
          download_link: `/voice/download/${lavoro.risultato}`,
        },
      })
      return
    }

    // --- scaricamento: cerca ovunque, come fa il servizio --------------------
    const scarico = percorso.match(/^\/voice\/download\/(.+)$/)
    if (scarico && req.method === 'GET') {
      const nome = decodeURIComponent(scarico[1] as string)
      if (!archivio.has(nome)) return invia(404, { error: `File '${nome}' non trovato` })
      res.writeHead(200, { 'content-type': 'audio/mpeg' })
      // Firma ID3: basta a provare che i byte arrivano fino in fondo.
      res.end(Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]))
      return
    }

    invia(404, { error: 'non trovato' })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const porta = (server.address() as { port: number }).port

  return Object.assign(finto as AudioFinto, {
    url: `http://127.0.0.1:${porta}`,
    archivio,
    richieste,
    chiudi: () => new Promise<void>((r) => server.close(() => r())),
  })
}
