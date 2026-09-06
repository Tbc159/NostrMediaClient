import { createServer, type Server } from 'node:http'

/**
 * media-manager finto, in-process: implementa il contratto, non lo simula.
 *
 * Serve perche' il servizio vero non e' raggiungibile da un browser (non
 * espone CORS e non ha HTTPS) e perche' i test non devono dipendere da un
 * ambiente di sviluppo altrui, che puo' essere spento. Le regole riprodotte
 * sono quelle che il client deve saper gestire: chiave mancante, duplicati,
 * generatore non implementato.
 */

export interface MediaManagerFinto {
  url: string
  /** Media caricati, nell'ordine di arrivo. */
  media: { id: number; title: string; media_type: string; size_bytes: number }[]
  /** Richieste di generazione ricevute, per verificare cosa e' stato mandato. */
  richieste: unknown[]
  chiudi(): Promise<void>
}

const CHIAVE = 'chiave-di-prova'

export async function avviaMediaManagerFinto(
  opzioni: { chiaveRichiesta?: string } = {},
): Promise<MediaManagerFinto> {
  const chiave = opzioni.chiaveRichiesta ?? CHIAVE
  const media: MediaManagerFinto['media'] = []
  const richieste: unknown[] = []
  let prossimoId = 1

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://interno')
    const percorso = url.pathname
    const rispondi = (stato: number, corpo: unknown): void => {
      res.writeHead(stato, { 'content-type': 'application/json' })
      res.end(JSON.stringify(corpo))
    }

    if (percorso.endsWith('/health')) return rispondi(200, { status: 'ok' })

    // Tutto il resto e' protetto: e' la prima cosa che il client deve saper
    // riconoscere, perche' un 401 non si distingue da un guasto se non lo si
    // traduce.
    if (req.headers['x-api-key'] !== chiave) {
      return rispondi(401, { title: 'Unauthorized', detail: 'No authorization token provided' })
    }

    if (percorso === '/v0/media' && req.method === 'GET') {
      const tipo = url.searchParams.get('type')
      if (!tipo) return rispondi(400, { detail: 'type mancante' })
      const titolo = url.searchParams.get('title')
      const items = media.filter(
        (m) => m.media_type === tipo && (!titolo || m.title.includes(titolo)),
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
        const item = { id: prossimoId++, title, media_type, size_bytes: corpo.length }
        media.push(item)
        rispondi(201, item)
      })
      return
    }

    if (percorso === '/v0/content/image' && req.method === 'POST') {
      const pezzi: Buffer[] = []
      req.on('data', (c: Buffer) => pezzi.push(c))
      req.on('end', () => {
        let corpo: { tipo?: string; logo_host?: unknown; layers?: unknown[] }
        try {
          corpo = JSON.parse(Buffer.concat(pezzi).toString('utf8'))
        } catch {
          return rispondi(400, { detail: 'json non valido' })
        }
        richieste.push(corpo)

        // Il generatore social e' dichiarato nel contratto ma non realizzato.
        if (corpo.tipo === 'social') {
          return rispondi(501, { detail: 'generatore social non implementato' })
        }

        const riferimenti = [
          corpo.logo_host,
          ...(corpo.layers ?? []).map((l) => (l as { media?: unknown }).media),
        ]
        const mancante = riferimenti.some(
          (r) => typeof r === 'string' && !media.some((m) => m.title.includes(r)),
        )
        if (mancante) return rispondi(400, { detail: 'asset non trovato' })

        const id = prossimoId++
        rispondi(201, {
          id,
          tipo: corpo.tipo,
          media_type: 'image/png',
          size_bytes: 1234,
          created_at_s: 1_800_000_000,
          content_url: `/v0/media/${id}/content`,
          download_url: `/v0/media/${id}/content?download=1`,
          warnings: [],
        })
      })
      return
    }

    if (/^\/v0\/media\/\d+\/content$/.test(percorso)) {
      res.writeHead(200, { 'content-type': 'image/png' })
      // Firma PNG: basta a provare che i byte arrivano fino a Blossom.
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      return
    }

    rispondi(404, { detail: 'non trovato' })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const porta = (server.address() as { port: number }).port

  return {
    url: `http://127.0.0.1:${porta}`,
    media,
    richieste,
    chiudi: () => new Promise<void>((r) => server.close(() => r())),
  }
}

export const CHIAVE_DI_PROVA = CHIAVE
