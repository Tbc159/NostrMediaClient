import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import { BlossomError, listBlobs } from '../src/media/blossom.js'

/**
 * `GET /list/<pubkey>` (BUD-12) and its optional authorization.
 *
 * It is not a theoretical detail: tried on 28 September 2026,
 * blossom.yakihonne.com answers without an authorization, nostr.download
 * answers 401. A client that always signed would cost the user a popup from
 * the extension even where it is not needed; one that never signed would show
 * half their files. Hence: without one first, and with the token only on a
 * refusal.
 */

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const firma = (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, sk)

const BLOB = [
  { url: 'http://x/aa.png', sha256: 'aa'.repeat(32), size: 10, type: 'image/png', uploaded: 1 },
]

/** A server that demands the authorization only when `pretende` is true. */
function avvia(
  pretende: boolean,
): Promise<{ url: string; chiudi: () => Promise<void>; visti: string[] }> {
  const visti: string[] = []
  const server: Server = createServer((req, res) => {
    const auth = req.headers.authorization
    visti.push(auth ?? '(no authorization)')
    if (pretende && !auth) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ message: 'auth required' }))
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
  it('signs nothing on a public server', async () => {
    const blob = await listBlobs(pubblico.url, pk, { firma, pubkeyFirma: pk })
    expect(blob).toHaveLength(1)
    expect(pubblico.visti).toEqual(['(no authorization)'])
  })

  it('retries with the token on a server that demands the authorization', async () => {
    const blob = await listBlobs(protetto.url, pk, { firma, pubkeyFirma: pk })
    expect(blob[0]?.type).toBe('image/png')
    expect(protetto.visti[0]).toBe('(no authorization)')
    expect(protetto.visti[1]).toMatch(/^Nostr /)

    // The token is a signed 24242, with the right verb and a future expiry.
    const evento = JSON.parse(
      Buffer.from((protetto.visti[1] as string).slice('Nostr '.length), 'base64').toString('utf8'),
    ) as { kind: number; tags: string[][]; pubkey: string }
    expect(evento.kind).toBe(24242)
    expect(evento.pubkey).toBe(pk)
    expect(evento.tags).toContainEqual(['t', 'list'])
    const scadenza = Number(evento.tags.find((t) => t[0] === 'expiration')?.[1])
    expect(scadenza).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('leaves a 401 an explained error when there is no key to sign with', async () => {
    // It is the read-only session's case: we say that the server wants an
    // authorization, instead of showing an empty gallery.
    await expect(listBlobs(protetto.url, pk)).rejects.toThrow(BlossomError)
    await expect(listBlobs(protetto.url, pk)).rejects.toThrow(/autorizzazione/)
  })
})
