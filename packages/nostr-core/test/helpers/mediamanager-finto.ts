import { createServer, type Server } from 'node:http'

/**
 * media-manager finto, in-process: implementa il contratto, non lo simula.
 *
 * Un finto solo per tutto il servizio, perche' il servizio e' uno: `media`,
 * `content` e `audio` sono suoi domini, con la stessa radice e la stessa
 * chiave.
 *
 * Le regole riprodotte sono quelle che il client sbaglierebbe in silenzio:
 *
 *  - **il `filename` non e' il `title`**. Lo genera il servizio, ed e'
 *    l'unico riferimento che risolve: passare il titolo prende un 400 con
 *    `field`/`value`/`searched_by`, come dal vero. E' il difetto che il
 *    client aveva davvero, e un finto che risolvesse per titolo lo avrebbe
 *    confermato invece di scoprirlo;
 *  - **i byte sono protetti**: senza chiave 401, a meno del token firmato,
 *    che e' l'unico modo per farli vedere a un tag del browser;
 *  - **le lavorazioni sono job**: 202 e `job_id`, poi `queued` → `running` →
 *    `succeeded`, e nessuna operazione distrugge la sorgente.
 */

export interface MediaFinto {
  id: number
  title: string
  filename: string
  media_type: string
  size_bytes: number
  status: 'ready'
  content_url: string
  download_url: string
  signed_url: string
  signed_url_expires_at_s: number
}

export interface MediaManagerFinto {
  url: string
  /** Media in archivio, nell'ordine di arrivo. */
  media: MediaFinto[]
  /** Richieste di generazione ricevute, per verificare cosa e' stato mandato. */
  richieste: unknown[]
  /** Corpi ricevuti dal dominio audio: percorso e corpo. */
  richiesteAudio: { percorso: string; corpo: Record<string, unknown> }[]
  /** Quanti giri di stato prima che un lavoro risulti finito. */
  giriPrimaDelFine: number
  /** Se vero, il prossimo lavoro fallisce. */
  faiFallire: boolean
  chiudi(): Promise<void>
}

const CHIAVE = 'chiave-di-prova'

/** Il nome file che genererebbe il servizio: slug del titolo, non il titolo. */
function generaFilename(titolo: string, mediaType: string): string {
  const base =
    titolo
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'media'
  const est =
    {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/m4a': 'm4a',
      'audio/wav': 'wav',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
    }[mediaType] ?? 'bin'
  // Il prefisso e' cio' che rende il filename diverso dal titolo: chi
  // riferisse per titolo passerebbe qui senza accorgersene.
  return `arc-${base}.${est}`
}

export async function avviaMediaManagerFinto(
  opzioni: { chiaveRichiesta?: string } = {},
): Promise<MediaManagerFinto> {
  const chiave = opzioni.chiaveRichiesta ?? CHIAVE
  const media: MediaFinto[] = []
  const richieste: unknown[] = []
  const richiesteAudio: MediaManagerFinto['richiesteAudio'] = []
  const lavori = new Map<
    string,
    { op: string; giri: number; fallito: boolean; prodotto?: MediaFinto }
  >()
  let prossimoId = 1
  let prossimoLavoro = 1

  const stato: Partial<MediaManagerFinto> = { giriPrimaDelFine: 1, faiFallire: false }

  const creaMedia = (titolo: string, mediaType: string, dimensione: number): MediaFinto => {
    const id = prossimoId++
    const item: MediaFinto = {
      id,
      title: titolo,
      filename: generaFilename(titolo, mediaType),
      media_type: mediaType,
      size_bytes: dimensione,
      status: 'ready',
      content_url: `/v0/media/${id}/content`,
      download_url: `/v0/media/${id}/content?download=1`,
      signed_url: `/v0/media/${id}/content?token=v1.${id}.finto`,
      signed_url_expires_at_s: 2_000_000_000,
    }
    media.push(item)
    return item
  }

  /** Risoluzione come il servizio: id o filename, mai il titolo. */
  const risolvi = (rif: unknown): MediaFinto | null => {
    if (typeof rif === 'number') return media.find((m) => m.id === rif) ?? null
    if (typeof rif !== 'string') return null
    const chiave = rif
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[_ ]/g, '-')
    return (
      [...media]
        .reverse()
        .find((m) => m.filename.toLowerCase().replace(/\.[^.]+$/, '') === chiave) ?? null
    )
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://interno')
    const percorso = url.pathname
    const rispondi = (codice: number, corpo: unknown): void => {
      res.writeHead(codice, {
        'content-type': 'application/json',
        'access-control-allow-origin': req.headers.origin ?? '*',
      })
      res.end(JSON.stringify(corpo))
    }
    const conCorpoJson = (fn: (corpo: Record<string, unknown>) => void): void => {
      const pezzi: Buffer[] = []
      req.on('data', (c: Buffer) => pezzi.push(c))
      req.on('end', () => {
        try {
          fn(JSON.parse(Buffer.concat(pezzi).toString('utf8')) as Record<string, unknown>)
        } catch {
          rispondi(400, { detail: 'json non valido' })
        }
      })
    }
    const rifNonRisolto = (campo: string, valore: unknown): void =>
      rispondi(400, {
        detail: 'asset non trovato',
        field: campo,
        value: valore,
        searched_by: 'filename',
      })

    if (percorso.endsWith('/health')) return rispondi(200, { status: 'ok' })

    // I byte: chiave, oppure il token firmato che il browser puo' portare da
    // solo in un tag src.
    const byte = /^\/v0\/media\/(\d+)\/content$/.exec(percorso)
    if (byte) {
      const item = media.find((m) => m.id === Number(byte[1]))
      const token = url.searchParams.get('token')
      if (!item) return rispondi(404, { detail: 'non trovato' })
      if (!token && req.headers['x-api-key'] !== chiave) {
        return rispondi(401, { detail: 'No authorization token provided' })
      }
      if (token && token !== `v1.${item.id}.finto`) {
        return rispondi(401, { detail: 'token non valido' })
      }
      res.writeHead(200, { 'content-type': item.media_type })
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      return
    }

    if (req.headers['x-api-key'] !== chiave) {
      return rispondi(401, { title: 'Unauthorized', detail: 'No authorization token provided' })
    }

    // ── dominio media ───────────────────────────────────────────────────────
    if (percorso === '/v0/media' && req.method === 'GET') {
      const tipo = url.searchParams.get('type')
      const titolo = url.searchParams.get('title')
      const items = media.filter(
        (m) =>
          (!tipo ||
            m.media_type === tipo ||
            (tipo === 'audio/mp3' && m.media_type === 'audio/mpeg')) &&
          (!titolo || m.title.includes(titolo)),
      )
      return rispondi(200, { items, page: 1, page_size: 20, total: items.length })
    }

    if (percorso === '/v0/media' && req.method === 'POST') {
      const pezzi: Buffer[] = []
      req.on('data', (c: Buffer) => pezzi.push(c))
      req.on('end', () => {
        const corpo = Buffer.concat(pezzi).toString('latin1')
        const campo = (nome: string): string | undefined =>
          corpo.match(new RegExp(`name="${nome}"\\r\\n\\r\\n([^\\r]*)`))?.[1]

        const title = campo('title')
        const media_type = campo('media_type')
        if (!title || !media_type) return rispondi(400, { detail: 'campi mancanti' })
        if (media.some((m) => m.title === title)) {
          return rispondi(409, { detail: 'media gia presente' })
        }
        rispondi(201, creaMedia(title, media_type, corpo.length))
      })
      return
    }

    if (percorso === '/v0/media/from-url' && req.method === 'POST') {
      return conCorpoJson((corpo) => {
        const url = String(corpo.url ?? '')
        const title = String(corpo.title ?? '')
        if (!/^https?:\/\//.test(url)) return rispondi(400, { detail: 'URL non consentito' })
        if (media.some((m) => m.title === title)) {
          return rispondi(409, { detail: 'media gia presente' })
        }
        const tipo = String(corpo.media_type ?? 'image/png')
        richieste.push({ from_url: url, title, media_type: tipo })
        rispondi(201, creaMedia(title, tipo, 2048))
      })
    }

    // ── dominio content ─────────────────────────────────────────────────────
    if (percorso === '/v0/content/image' && req.method === 'POST') {
      return conCorpoJson((corpo) => {
        richieste.push(corpo)

        const riferimenti: [string, unknown][] = [
          ...(corpo.logo_host !== undefined
            ? ([['logo_host', corpo.logo_host]] as [string, unknown][])
            : []),
          ...((corpo.ospiti as unknown[]) ?? []).map(
            (o, i) => [`ospiti[${i}]`, o] as [string, unknown],
          ),
          ...((corpo.layers as { media?: unknown }[]) ?? []).map(
            (l, i) => [`layers[${i}].media`, l.media] as [string, unknown],
          ),
        ]
        for (const [campo, valore] of riferimenti) {
          if (valore === undefined || valore === '') continue
          if (!risolvi(valore)) return rifNonRisolto(campo, valore)
        }

        const prodotto = creaMedia(`generata-${prossimoId}`, 'image/png', 1234)
        rispondi(201, {
          id: prodotto.id,
          tipo: corpo.tipo,
          media_type: 'image/png',
          size_bytes: prodotto.size_bytes,
          created_at_s: 1_800_000_000,
          content_url: prodotto.content_url,
          download_url: prodotto.download_url,
          signed_url: prodotto.signed_url,
          signed_url_expires_at_s: prodotto.signed_url_expires_at_s,
          warnings: [],
        })
      })
    }

    // ── dominio audio ───────────────────────────────────────────────────────
    const opAudio = /^\/v0\/audio\/(normalize|silence|convert|analyze)$/.exec(percorso)
    if (opAudio && req.method === 'POST') {
      return conCorpoJson((corpo) => {
        richiesteAudio.push({ percorso, corpo })
        const sorgente = risolvi(corpo.source)
        if (!sorgente) return rifNonRisolto('source', corpo.source)

        const op = opAudio[1] as string
        const formato = String(corpo.format ?? (op === 'silence' ? 'audio/wav' : 'audio/mpeg'))
        const id = `${op}-${prossimoLavoro++}`
        lavori.set(id, {
          op,
          giri: 0,
          fallito: Boolean(stato.faiFallire),
          // La sorgente resta in archivio: rifare con parametri diversi non
          // richiede ricaricare nulla.
          prodotto: creaMedia(
            String(corpo.title ?? `${sorgente.title} (${op})`),
            formato,
            sorgente.size_bytes,
          ),
        })
        rispondi(202, { job_id: id, status: 'queued', op, poll_url: `/v0/audio/job/${id}` })
      })
    }

    const job = /^\/v0\/audio\/job\/(.+)$/.exec(percorso)
    if (job && req.method === 'GET') {
      const id = decodeURIComponent(job[1] as string)
      const lavoro = lavori.get(id)
      if (!lavoro) return rispondi(404, {})

      const comune = { job_id: id, op: lavoro.op, created_at_s: 1, updated_at_s: 2 }
      if (lavoro.fallito) {
        return rispondi(200, {
          ...comune,
          status: 'failed',
          error: { detail: 'ffmpeg si e’ fermato' },
        })
      }
      if (lavoro.giri < (stato.giriPrimaDelFine ?? 1)) {
        lavoro.giri += 1
        return rispondi(200, { ...comune, status: lavoro.giri === 1 ? 'queued' : 'running' })
      }
      return rispondi(200, {
        ...comune,
        status: 'succeeded',
        result: { media: [lavoro.prodotto] },
      })
    }

    rispondi(404, { detail: 'non trovato' })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const porta = (server.address() as { port: number }).port

  return Object.assign(stato as MediaManagerFinto, {
    url: `http://127.0.0.1:${porta}`,
    media,
    richieste,
    richiesteAudio,
    chiudi: () => new Promise<void>((r) => server.close(() => r())),
  })
}

export const CHIAVE_DI_PROVA = CHIAVE
