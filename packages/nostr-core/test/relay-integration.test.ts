import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { noteDefinition } from '../src/kinds/definitions/note.js'
import { createRelayPool, type RelayPool } from '../src/relays/pool.js'
import { publishEvent } from '../src/relays/publish.js'
import { loadTimeline } from '../src/relays/request.js'
import { avviaRelayFinto, type RelayFinto } from './helpers/fake-relay.js'

/**
 * Integration with a real relay, minimal and in-process though it is.
 *
 * A mock of the pool would only prove that our code calls itself. Here the
 * traffic goes through a WebSocket and real NIP-01 messages, which is the only
 * way to see the cases that really count: refusals, silences, and the
 * replacement of addressable events.
 */

const chiave = generateSecretKey()
const ctx = { pubkey: 'ab'.repeat(32), now: Math.floor(Date.now() / 1000) }

function nota(testo: string) {
  return finalizeEvent(noteDefinition.build({ content: testo }, ctx), chiave)
}

describe('publishing to a relay and reading back', () => {
  let pool: RelayPool
  let buono: RelayFinto
  let cattivo: RelayFinto

  beforeAll(async () => {
    pool = createRelayPool()
    buono = await avviaRelayFinto({ tipo: 'accetta' })
    cattivo = await avviaRelayFinto({
      tipo: 'rifiuta',
      messaggio: 'restricted: not allowed to write.',
    })
  })

  afterAll(async () => {
    pool.close()
    await Promise.all([buono.chiudi(), cattivo.chiudi()])
  })

  it('delivers the event and reads it back identical', async () => {
    const evento = nota('prova di andata e ritorno')
    const esito = await publishEvent(pool, [buono.url], evento)
    expect(esito.riuscita).toBe(true)

    const letti = await loadTimeline(pool, [buono.url], { ids: [evento.id] }, { timeoutMs: 5000 })
    expect(letti[0]?.id).toBe(evento.id)
    expect(letti[0]?.content).toBe('prova di andata e ritorno')
  })

  it("reports every relay's outcome in parallel, including the ones that refuse", async () => {
    // It is the normal case on Nostr: a mixed list of relays that accept and
    // relays that do not. A single result would hide which did what.
    const esito = await publishEvent(pool, [buono.url, cattivo.url], nota('misto'), {
      strategia: 'tutti',
    })

    expect(esito.risultati).toHaveLength(2)
    expect(esito.accettati).toEqual([buono.url])
    expect(esito.riuscita).toBe(true)

    const rifiuto = esito.risultati.find((r) => r.url === cattivo.url)
    expect(rifiuto?.esito).toBe('rifiutato')
    expect(rifiuto?.motivo).toMatch(/non ti consente di scrivere/)
  })

  it('stops at the first relay that takes the event on, in rotation', async () => {
    // That way one connection is opened at a time: it is why this is the
    // default strategy. The price is that the event ends up on a single relay,
    // and the result has to say so rather than leave it to be guessed.
    const esito = await publishEvent(pool, [buono.url, cattivo.url], nota('rotazione'))

    expect(esito.riuscita).toBe(true)
    expect(esito.accettati).toEqual([buono.url])

    const saltato = esito.risultati.find((r) => r.url === cattivo.url)
    expect(saltato?.esito).toBe('non tentato')
  })

  it('goes on past a relay that refuses, in rotation', async () => {
    // It is the point of the rotation: a refusal must not stop the chain,
    // otherwise one hostile relay at the top of the list would be enough to
    // leave the client unable to publish.
    const tentati: string[] = []
    const esito = await publishEvent(pool, [cattivo.url, buono.url], nota('perseveranza'), {
      onTentativo: (url) => tentati.push(url),
    })

    expect(tentati).toEqual([cattivo.url, buono.url])
    expect(esito.riuscita).toBe(true)
    expect(esito.accettati).toEqual([buono.url])
    expect(esito.risultati[0]?.esito).toBe('rifiutato')
  })

  it('tries every relay before giving up, in rotation', async () => {
    const esito = await publishEvent(pool, [cattivo.url, cattivo.url], nota('nessuno'))
    // The second URL is the same as the first and gets deduplicated: a single
    // attempt is left, but the result still has to say that nobody accepted.
    expect(esito.riuscita).toBe(false)
    expect(esito.risultati.every((r) => r.esito === 'rifiutato')).toBe(true)
  })

  it('counts republishing the same event as a success', async () => {
    // The relay answers `duplicate`: it has it already, so for the publisher
    // the result is the same as an acceptance.
    const evento = nota('la stessa, due volte')
    await publishEvent(pool, [buono.url], evento)
    const secondo = await publishEvent(pool, [buono.url], evento)

    expect(secondo.riuscita).toBe(true)
    expect(secondo.risultati[0]?.esito).toBe('duplicato')
  })

  it('fails without throwing when no relay accepts', async () => {
    const esito = await publishEvent(pool, [cattivo.url], nota('respinta'))
    expect(esito.riuscita).toBe(false)
    expect(esito.accettati).toEqual([])
  })

  it('gives up by the deadline when the relay does not answer', async () => {
    // A relay that accepts the connection and then falls silent would leave
    // the button spinning for ever: the deadline is what makes the UI honest.
    const muto = await avviaRelayFinto({ tipo: 'muto' })
    try {
      const inizio = Date.now()
      const esito = await publishEvent(pool, [muto.url], nota('nel vuoto'), { timeoutMs: 1500 })
      expect(esito.riuscita).toBe(false)
      expect(esito.risultati[0]?.esito).toBe('irraggiungibile')
      expect(Date.now() - inizio).toBeLessThan(6000)
    } finally {
      await muto.chiudi()
    }
  })

  it('refuses to publish with no relays, instead of succeeding into the void', async () => {
    await expect(publishEvent(pool, [], nota('x'))).rejects.toThrow(/Nessun relay/)
  })

  it('replaces an addressable event instead of sitting beside it', async () => {
    // It is the whole point of the addressable kinds: republishing with the
    // same `d` *is* the edit. If two came back on reading, the calendar would
    // show the meeting with the old title next to the new one.
    const d = `prova-${Date.now()}`
    const base = { identifier: d, start: ctx.now + 3600, startTzid: 'Europe/Rome' }

    const primo = finalizeEvent(
      calendarTimeEventDefinition.build({ ...base, title: 'Titolo iniziale' }, ctx),
      chiave,
    )
    const secondo = finalizeEvent(
      calendarTimeEventDefinition.build(
        { ...base, title: 'Titolo corretto' },
        { ...ctx, now: ctx.now + 1 },
      ),
      chiave,
    )

    await publishEvent(pool, [buono.url], primo)
    await publishEvent(pool, [buono.url], secondo)

    const letti = await loadTimeline(
      pool,
      [buono.url],
      { kinds: [31923], '#d': [d] },
      { timeoutMs: 5000 },
    )
    expect(letti).toHaveLength(1)
    expect(letti[0]?.tags.find((t) => t[0] === 'title')?.[1]).toBe('Titolo corretto')
  })

  it('returns an empty list when the relay is unreachable', async () => {
    // A feed showing fewer notes is useful; one that errors out because a
    // relay is down is not.
    const letti = await loadTimeline(
      pool,
      ['ws://127.0.0.1:1'],
      { kinds: [1] },
      { timeoutMs: 2000 },
    )
    expect(letti).toEqual([])
  })
})
