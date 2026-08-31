import { NostrConnectSigner } from 'applesauce-signers'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'

import { podcastEpisodeDefinition } from '../src/kinds/definitions/podcast.js'
import type { EventTemplate } from '../src/kinds/types.js'
import { createRelayPool, type RelayPool } from '../src/relays/pool.js'
import { avviaBanco, type Banco } from '../src/signers/bunker.js'
import { collegaDelega } from '../src/signers/delega.js'
import type { RichiestaFirma } from '../src/signers/types.js'
import { avviaRelayFinto, type RelayFinto } from './helpers/relay-finto.js'

/**
 * Firma delegata NIP-46, dal vero: due parti, un relay in mezzo.
 *
 * Non ci sono mock. Il banco e il richiedente hanno pool distinti, quindi
 * WebSocket distinti, e tutto quello che si scambiano passa da un relay
 * NIP-01 e dalla cifratura NIP-44 della libreria. E' l'unico modo per
 * verificare cio' che conta davvero: che l'evento che torna sia firmato
 * dalla chiave del podcast e non da quella di chi lo ha chiesto.
 */

const chiavePodcast = generateSecretKey()
const pubkeyPodcast = getPublicKey(chiavePodcast)

const CTX = { pubkey: pubkeyPodcast, now: 1_800_000_000 }

const episodio = (titolo: string): EventTemplate =>
  podcastEpisodeDefinition.build(
    { title: titolo, audio: [{ url: 'https://cdn.example/p1.mp3', mime: 'audio/mpeg' }] },
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
 * Apre un banco nuovo per ogni prova.
 *
 * Ognuno con la propria chiave di trasporto, e non per pulizia: la libreria
 * ammette **un solo richiedente per volta**, quindi banchi condivisi fra prove
 * si rifiuterebbero a vicenda.
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

describe('firma delegata fra due parti', () => {
  it('restituisce un episodio firmato dalla chiave del podcast, non da chi lo chiede', async () => {
    const banco = await apriBanco({})
    const delega = await collegaDelega({
      pool: poolDelega,
      uri: banco.uri,
      autoreAtteso: pubkeyPodcast,
      kinds: [54],
    })
    daChiudere.push({ ferma: () => delega.scollega() })

    const firmato = await delega.firma(episodio('Puntata uno'))

    // Il punto di tutto il meccanismo: chi ha preparato l'episodio non
    // compare da nessuna parte, e la firma regge la verifica.
    expect(firmato.pubkey).toBe(pubkeyPodcast)
    expect(verifyEvent(firmato)).toBe(true)
    expect(firmato.kind).toBe(54)
    expect(firmato.tags).toContainEqual(['title', 'Puntata uno'])
  }, 20_000)

  it(
    'dichiara quale identita' + ' firma, cosi da poterla confrontare con un npub',
    async () => {
      const banco = await apriBanco({})
      const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54] })
      daChiudere.push({ ferma: () => delega.scollega() })

      // L'indirizzo del banco porta la chiave di *trasporto*, che per NIP-46
      // e' un'altra cosa: l'identita' si conosce solo chiedendola.
      expect(delega.autore).toBe(pubkeyPodcast)
      expect(delega.autore).not.toBe(banco.trasporto)
    },
    20_000,
  )

  it('rifiuta il collegamento se il banco firma con un altra identita', async () => {
    const banco = await apriBanco({})
    const altro = getPublicKey(generateSecretKey())

    await expect(
      collegaDelega({
        pool: poolDelega,
        uri: banco.uri,
        autoreAtteso: altro,
        kinds: [54],
      }),
    ).rejects.toThrow(/identita/)
  }, 20_000)
})

describe('cosa il banco non firma', () => {
  it('respinge un kind fuori elenco senza nemmeno disturbare chi approva', async () => {
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ kinds: [54], registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54, 1] })
    daChiudere.push({ ferma: () => delega.scollega() })

    const nota: EventTemplate = { kind: 1, content: 'a nome tuo', tags: [], created_at: CTX.now }
    await expect(delega.firma(nota)).rejects.toThrow()

    // Il filtro sui kind viene prima del giudizio umano: chi tiene il banco
    // non deve poter approvare per stanchezza una nota firmata a suo nome.
    expect(registro).toHaveLength(0)
  }, 20_000)

  it('lo stesso kind, se in elenco, viene firmato: il filtro discrimina davvero', async () => {
    // Controprova del caso qui sopra. Senza, un rifiuto dovuto a un guasto
    // qualsiasi passerebbe per un rifiuto di politica.
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ kinds: [54, 1], registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54, 1] })
    daChiudere.push({ ferma: () => delega.scollega() })

    const nota: EventTemplate = { kind: 1, content: 'a nome tuo', tags: [], created_at: CTX.now }
    const firmato = await delega.firma(nota)

    expect(firmato.pubkey).toBe(pubkeyPodcast)
    expect(registro).toHaveLength(1)
  }, 20_000)

  it('non firma se chi tiene la chiave rifiuta', async () => {
    const registro: RichiestaFirma[] = []
    const banco = await apriBanco({ decidi: () => false, registro })
    const delega = await collegaDelega({ pool: poolDelega, uri: banco.uri, kinds: [54] })
    daChiudere.push({ ferma: () => delega.scollega() })

    await expect(delega.firma(episodio('Puntata rifiutata'))).rejects.toThrow()
    expect(registro).toHaveLength(1)
    expect(registro[0]?.kind).toBe(54)
  }, 20_000)

  it('non decifra nulla con la chiave del titolare', async () => {
    // NIP-46 non offre solo la firma: espone anche `nip04_*` e `nip44_*`.
    // Un richiedente potrebbe farsi aprire le bozze cifrate o i messaggi
    // diretti di chi tiene il banco, che non ha nulla a che vedere con il
    // permesso di pubblicare un episodio.
    const banco = await apriBanco({})
    const cliente = await NostrConnectSigner.fromBunkerURI(banco.uri, { pool: poolDelega })
    daChiudere.push({ ferma: () => cliente.close() })

    await expect(cliente.nip44Decrypt(pubkeyPodcast, 'contenuto-cifrato')).rejects.toThrow()
    await expect(cliente.nip04Decrypt(pubkeyPodcast, 'contenuto-cifrato')).rejects.toThrow()
  }, 20_000)
})
