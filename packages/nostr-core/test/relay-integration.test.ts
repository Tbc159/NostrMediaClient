import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { noteDefinition } from '../src/kinds/definitions/note.js'
import { createRelayPool, type RelayPool } from '../src/relays/pool.js'
import { publishEvent } from '../src/relays/publish.js'
import { loadTimeline } from '../src/relays/request.js'
import { avviaRelayFinto, type RelayFinto } from './helpers/relay-finto.js'

/**
 * Integrazione con un relay vero, seppure minimo e in-process.
 *
 * Un mock del pool proverebbe solo che il nostro codice chiama se stesso. Qui
 * il traffico passa da un WebSocket e da messaggi NIP-01 reali, che e' l'unico
 * modo per vedere i casi che contano davvero: rifiuti, silenzi, e la
 * sostituzione degli eventi addressable.
 */

const chiave = generateSecretKey()
const ctx = { pubkey: 'ab'.repeat(32), now: Math.floor(Date.now() / 1000) }

function nota(testo: string) {
  return finalizeEvent(noteDefinition.build({ content: testo }, ctx), chiave)
}

describe('pubblicazione e rilettura su un relay', () => {
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

  it('consegna l' + "'evento e lo rilegge identico", async () => {
    const evento = nota('prova di andata e ritorno')
    const esito = await publishEvent(pool, [buono.url], evento)
    expect(esito.riuscita).toBe(true)

    const letti = await loadTimeline(pool, [buono.url], { ids: [evento.id] }, { timeoutMs: 5000 })
    expect(letti[0]?.id).toBe(evento.id)
    expect(letti[0]?.content).toBe('prova di andata e ritorno')
  })

  it('riporta l' + "'esito di ogni relay invece di fermarsi al primo rifiuto", async () => {
    // E' il caso normale su Nostr: un elenco misto di relay che accettano e
    // relay che no. Un risultato unico nasconderebbe quale ha fatto cosa.
    const esito = await publishEvent(pool, [buono.url, cattivo.url], nota('misto'))

    expect(esito.risultati).toHaveLength(2)
    expect(esito.accettati).toEqual([buono.url])
    expect(esito.riuscita).toBe(true)

    const rifiuto = esito.risultati.find((r) => r.url === cattivo.url)
    expect(rifiuto?.esito).toBe('rifiutato')
    expect(rifiuto?.motivo).toMatch(/non ti consente di scrivere/)
  })

  it('considera riuscita la pubblicazione ripetuta dello stesso evento', async () => {
    // Il relay risponde `duplicate`: ce l'ha gia', quindi per chi pubblica il
    // risultato e' identico a un'accettazione.
    const evento = nota('la stessa, due volte')
    await publishEvent(pool, [buono.url], evento)
    const secondo = await publishEvent(pool, [buono.url], evento)

    expect(secondo.riuscita).toBe(true)
    expect(secondo.risultati[0]?.esito).toBe('duplicato')
  })

  it('fallisce senza lanciare quando nessun relay accetta', async () => {
    const esito = await publishEvent(pool, [cattivo.url], nota('respinta'))
    expect(esito.riuscita).toBe(false)
    expect(esito.accettati).toEqual([])
  })

  it('si arrende entro la scadenza se il relay non risponde', async () => {
    // Un relay che accetta la connessione e poi tace lascerebbe il pulsante a
    // girare per sempre: la scadenza e' cio' che rende la UI onesta.
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

  it('rifiuta di pubblicare senza relay, invece di riuscire nel vuoto', async () => {
    await expect(publishEvent(pool, [], nota('x'))).rejects.toThrow(/Nessun relay/)
  })

  it('sostituisce un evento addressable invece di affiancarlo', async () => {
    // E' il senso stesso dei kind addressable: ripubblicare con lo stesso `d`
    // e' la modifica. Se in lettura ne comparissero due, il calendario
    // mostrerebbe la riunione col titolo vecchio accanto a quello nuovo.
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

  it('restituisce una lista vuota quando il relay non e' + ' raggiungibile', async () => {
    // Un feed che mostra meno note e' utile; uno che va in errore perche' un
    // relay e' giu' non lo e'.
    const letti = await loadTimeline(
      pool,
      ['ws://127.0.0.1:1'],
      { kinds: [1] },
      { timeoutMs: 2000 },
    )
    expect(letti).toEqual([])
  })
})
