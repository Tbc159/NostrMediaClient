import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import { BlossomError, listBlobs } from '../src/media/blossom.js'

/**
 * `GET /list/<pubkey>` (BUD-12) e la sua autorizzazione facoltativa.
 *
 * Non e' un dettaglio teorico: provato il 28 settembre 2026,
 * blossom.yakihonne.com risponde senza autorizzazione, nostr.download
 * risponde 401. Un client che firmasse sempre chiederebbe all'utente un
 * popup dell'estensione anche dove non serve; uno che non firmasse mai
 * mostrerebbe metà dei suoi file. Quindi: prima senza, e solo al rifiuto con
 * il token.
 */

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const firma = (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, sk)

const BLOB = [
  { url: 'http://x/aa.png', sha256: 'aa'.repeat(32), size: 10, type: 'image/png', uploaded: 1 },
]

/** Server che pretende l'autorizzazione solo se `pretende` e' vero. */
function avvia(
  pretende: boolean,
): Promise<{ url: string; chiudi: () => Promise<void>; visti: string[] }> {
  const visti: string[] = []
  const server: Server = createServer((req, res) => {
    const auth = req.headers.authorization
    visti.push(auth ?? '(senza autorizzazione)')
    if (pretende && !auth) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ message: 'auth richiesta' }))
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(BLOB))
  })
  return new Promise((risolvi) => {
    server.listen(0, () => {
      const porta = (server.address() as { port: number }).port
      risolvi({
        url: `http://localhost:${porta}`,
        visti,
        chiudi: () => new Promise((fine) => server.close(() => fine())),
      })
    })
  })
}

let pubblico: Awaited<ReturnType<typeof avvia>>
let protetto: Awaited<ReturnType<typeof avvia>>

beforeAll(async () => {
  pubblico = await avvia(false)
  protetto = await avvia(true)
})
afterAll(async () => {
  await pubblico.chiudi()
  await protetto.chiudi()
})

describe('listBlobs', () => {
  it('su un server pubblico non firma nulla', async () => {
    const blob = await listBlobs(pubblico.url, pk, { firma, pubkeyFirma: pk })
    expect(blob).toHaveLength(1)
    expect(pubblico.visti).toEqual(['(senza autorizzazione)'])
  })

  it('su un server che pretende l’autorizzazione riprova con il token', async () => {
    const blob = await listBlobs(protetto.url, pk, { firma, pubkeyFirma: pk })
    expect(blob[0]?.type).toBe('image/png')
    expect(protetto.visti[0]).toBe('(senza autorizzazione)')
    expect(protetto.visti[1]).toMatch(/^Nostr /)

    // Il token e' un 24242 firmato, con il verbo giusto e una scadenza futura.
    const evento = JSON.parse(
      Buffer.from((protetto.visti[1] as string).slice('Nostr '.length), 'base64').toString('utf8'),
    ) as { kind: number; tags: string[][]; pubkey: string }
    expect(evento.kind).toBe(24242)
    expect(evento.pubkey).toBe(pk)
    expect(evento.tags).toContainEqual(['t', 'list'])
    const scadenza = Number(evento.tags.find((t) => t[0] === 'expiration')?.[1])
    expect(scadenza).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('senza chiave che firmi, un 401 resta un errore spiegato', async () => {
    // E' il caso della sessione in sola lettura: si dice che il server vuole
    // un'autorizzazione, invece di mostrare una galleria vuota.
    await expect(listBlobs(protetto.url, pk)).rejects.toThrow(BlossomError)
    await expect(listBlobs(protetto.url, pk)).rejects.toThrow(/autorizzazione/)
  })
})
