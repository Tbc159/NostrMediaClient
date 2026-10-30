import { NostrConnectSigner } from 'applesauce-signers'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'

import { podcastEpisodeDefinition } from '../src/kinds/definitions/podcast.js'
import type { EventTemplate } from '../src/kinds/types.js'
import { createRelayPool, type RelayPool } from '../src/relays/pool.js'
import { avviaBanco, type Banco } from '../src/signers/bunker.js'
import { collegaDelega } from '../src/signers/delegation.js'
import type { RichiestaFirma } from '../src/signers/types.js'
import { avviaRelayFinto, type RelayFinto } from './helpers/fake-relay.js'

/**
 * NIP-46 delegated signing, for real: two parties, a relay in between.
 *
 * There are no mocks. The desk and the requester have distinct pools, hence
 * distinct WebSockets, and everything they exchange goes through a NIP-01
 * relay and the library's NIP-44 encryption. It is the only way to verify what
 * really counts: that the event that comes back is signed by the podcast's key
 * and not by the key of whoever asked for it.
 */

const chiavePodcast = generateSecretKey()
const pubkeyPodcast = getPublicKey(chiavePodcast)

const CTX = { pubkey: pubkeyPodcast, now: 1_800_000_000 }

const episodio = (titolo: string): EventTemplate =>
  podcastEpisodeDefinition.build(
    {
      title: titolo,
      description: 'Di cosa parla.',
      audio: [{ url: 'https://cdn.example/p1.mp3', mime: 'audio/mpeg' }],
    },
    CTX,
  )

let relay: RelayFinto
let poolBanco: RelayPool
let poolDelega: RelayPool
const daChiudere: { ferma: () => Promise<void> }[] = []

beforeAll(async () => {
  relay = await avviaRelayFinto({ tipo: 'accetta' })
  poolBanco = createRelayPool()
  poolDelega = createRelayPool()
})

afterEach(async () => {
  while (daChiudere.length)
    await daChiudere
      .pop()
      ?.ferma()
      .catch(() => {})
})

afterAll(async () => {
  poolBanco.close()
  poolDelega.close()
  await relay.chiudi()
})

/**
 * Opens a new desk for every test.
 *
 * Each with its own transport key, and not for tidiness: the library allows
 * **one requester at a time**, so desks shared between tests would refuse each
 * other.
 */
async function apriBanco(opzioni: {
  kinds?: number[]
  decidi?: (r: RichiestaFirma) => boolean
  registro?: RichiestaFirma[]
}): Promise<Banco> {
  const banco = await avviaBanco({
    pool: poolBanco,
    relays: [relay.url],
    identita: {
      pubkey: () => Promise.resolve(pubkeyPodcast),
      firma: (template) => Promise.resolve(finalizeEvent(template, chiavePodcast)),
    },
    chiaveTrasporto: generateSecretKey(),
    segreto: 'segreto-di-prova',
    kindsConsentiti: opzioni.kinds ?? [54],
    approva: (richiesta) => {
      opzioni.registro?.push(richiesta)
      return Promise.resolve(opzioni.decidi ? opzioni.decidi(richiesta) : true)
    },
  })
  daChiudere.push(banco)
  return banco
}

describe('delegated signing between two parties', () => {
  it("returns an episode signed by the podcast's key, not by the requester's", async () => {
    const banco = await apriBanco({})
    const delega = await collegaDelega({
      pool: poolDelega,
      uri: banco.uri,
      autoreAtteso: pubkeyPodcast,
      kinds: [54],
    })
    daChiudere.push({ ferma: () => delega.scollega() })

    const firmato = await delega.firma(episodio('Puntata uno'))

    // The point of the whole mechanism: whoever prepared the episode appears
    // nowhere, and the signature stands up to verification.
    expect(firmato.pubkey).toBe(pubkeyPodcast)
    expect(verifyEvent(firmato)).toBe(true)
    expect(firmato.kind).toBe(54)
    expect(firmato.tags).toContainEqual(['title', 'Puntata uno'])
  }, 20_000)

  it('declares which identity signs, so it can be compared with an npub', async () => {
    const banco = await apriBanco({})
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54] })
    daChiudere.push({ ferma: () => delega.scollega() })

    // The desk's address carries the *transport* key, which under NIP-46 is
    // a different thing: the identity is known only by asking for it.
    expect(delega.autore).toBe(pubkeyPodcast)
    expect(delega.autore).not.toBe(banco.trasporto)
  }, 20_000)

  it('refuses the connection when the desk signs with another identity', async () => {
    const banco = await apriBanco({})
    const altro = getPublicKey(generateSecretKey())

    await expect(
      collegaDelega({
        pool: poolDelega,
        uri: banco.uri,
        autoreAtteso: altro,
        kinds: [54],
      }),
    ).rejects.toThrow(/identità/)
  }, 20_000)
})

describe('what the desk does not sign', () => {
  it('turns down a kind off the list without even disturbing whoever approves', async () => {
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ kinds: [54], registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54, 1] })
    daChiudere.push({ ferma: () => delega.scollega() })

    const nota: EventTemplate = { kind: 1, content: 'a nome tuo', tags: [], created_at: CTX.now }
    await expect(delega.firma(nota)).rejects.toThrow()

    // The filter on the kinds comes before the human judgement: whoever keeps
    // the desk must not be able to approve, out of weariness, a note signed in
    // their name.
    expect(registro).toHaveLength(0)
  }, 20_000)

  it('signs the same kind when it is on the list: the filter really discriminates', async () => {
    // The counter-check to the case above. Without it, a refusal due to any
    // old fault would pass for a refusal on policy.
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ kinds: [54, 1], registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54, 1] })
    daChiudere.push({ ferma: () => delega.scollega() })

    const nota: EventTemplate = { kind: 1, content: 'a nome tuo', tags: [], created_at: CTX.now }
    const firmato = await delega.firma(nota)

    expect(firmato.pubkey).toBe(pubkeyPodcast)
    expect(registro).toHaveLength(1)
  }, 20_000)

  it('does not sign when the key holder refuses', async () => {
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ decidi: () => false, registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54] })
    daChiudere.push({ ferma: () => delega.scollega() })

    await expect(delega.firma(episodio('Puntata rifiutata'))).rejects.toThrow()
    expect(registro).toHaveLength(1)
    expect(registro[0]?.kind).toBe(54)
  }, 20_000)

  it("decrypts nothing with the holder's key", async () => {
    // NIP-46 does not offer signing alone: it also exposes `nip04_*` and
    // `nip44_*`. A requester could have the encrypted drafts or the direct
    // messages of whoever keeps the desk opened for them, which has nothing to
    // do with permission to publish an episode.
    const banco = await apriBanco({})
    const cliente = await NostrConnectSigner.fromBunkerURI(banco.uri, { pool: poolDelega })
    daChiudere.push({ ferma: () => cliente.close() })

    await expect(cliente.nip44Decrypt(pubkeyPodcast, 'contenuto-cifrato')).rejects.toThrow()
    await expect(cliente.nip04Decrypt(pubkeyPodcast, 'contenuto-cifrato')).rejects.toThrow()
  }, 20_000)
})
