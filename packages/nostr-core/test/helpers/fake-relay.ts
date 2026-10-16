import { WebSocketServer, type WebSocket } from 'ws'

import type { NostrEvent } from '../../src/kinds/types.js'

/**
 * A minimal in-process NIP-01 relay, for the integration tests.
 *
 * It is there to exercise the whole path — WebSocket, EVENT, OK, REQ, EOSE —
 * without depending on a public relay. A mock of the pool would only prove
 * that our code calls itself; here the traffic really goes over the network,
 * and with it through the cases that count: negative answers, the replacement
 * of addressables, duplicates.
 *
 * It is not a relay: it verifies no signatures, applies no limits, persists
 * nothing.
 */
export type ModoRelay =
  | { tipo: 'accetta' }
  | { tipo: 'rifiuta'; messaggio: string }
  /** Never answers the EVENT: it mimics a relay that accepts the connection and falls silent. */
  | { tipo: 'muto' }

export interface RelayFinto {
  url: string
  eventi: NostrEvent[]
  chiudi(): Promise<void>
}

export async function avviaRelayFinto(modo: ModoRelay = { tipo: 'accetta' }): Promise<RelayFinto> {
  const eventi: NostrEvent[] = []
  // Port 0: the system assigns a free one, so the tests can run in parallel
  // without colliding.
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((risolvi) => wss.once('listening', risolvi))
  const porta = (wss.address() as { port: number }).port

  /*
   * The open subscriptions, for delivering in real time.
   *
   * A relay that answers only with what it already has in store is enough to
   * test publishing, but not a dialogue: NIP-46 is made of requests and
   * answers crossing on a relay while both parties are listening. Without
   * immediate delivery the signing desk would never see anything arrive.
   */
  const sottoscrizioni: { ws: WebSocket; id: string; filtri: Filtro[] }[] = []

  const consegna = (evento: NostrEvent): void => {
    for (const s of sottoscrizioni) {
      if (s.ws.readyState !== s.ws.OPEN) continue
      if (!s.filtri.some((f) => corrisponde(evento, f))) continue
      s.ws.send(JSON.stringify(['EVENT', s.id, evento]))
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    ws.on('close', () => {
      for (let i = sottoscrizioni.length - 1; i >= 0; i--) {
        if (sottoscrizioni[i]?.ws === ws) sottoscrizioni.splice(i, 1)
      }
    })

    ws.on('message', (grezzo) => {
      let messaggio: unknown
      try {
        messaggio = JSON.parse(grezzo.toString())
      } catch {
        return
      }
      if (!Array.isArray(messaggio)) return
      const [tipo] = messaggio as [string, ...unknown[]]

      if (tipo === 'EVENT') {
        const evento = messaggio[1] as NostrEvent
        if (modo.tipo === 'muto') return
        if (modo.tipo === 'rifiuta') {
          ws.send(JSON.stringify(['OK', evento.id, false, modo.messaggio]))
          return
        }
        const nota = memorizza(eventi, evento)
        ws.send(JSON.stringify(['OK', evento.id, true, nota]))
        // A duplicate is not redistributed: the listeners have had it already.
        if (nota === '') consegna(evento)
        return
      }

      if (tipo === 'REQ') {
        const id = messaggio[1] as string
        const filtri = messaggio.slice(2) as Filtro[]
        const trovati = eventi
          .filter((e) => filtri.some((f) => corrisponde(e, f)))
          .sort((a, b) => b.created_at - a.created_at)
        for (const e of trovati) ws.send(JSON.stringify(['EVENT', id, e]))
        ws.send(JSON.stringify(['EOSE', id]))
        // Registered **after** the EOSE: the subscription stays open and will
        // receive whatever arrives from here on.
        sottoscrizioni.push({ ws, id, filtri })
        return
      }

      if (tipo === 'CLOSE') {
        const id = messaggio[1] as string
        const i = sottoscrizioni.findIndex((s) => s.ws === ws && s.id === id)
        if (i >= 0) sottoscrizioni.splice(i, 1)
        ws.send(JSON.stringify(['CLOSED', id, '']))
      }
    })
  })

  return {
    url: `ws://127.0.0.1:${porta}`,
    eventi,
    chiudi: () =>
      new Promise<void>((risolvi) => {
        for (const c of wss.clients) c.terminate()
        wss.close(() => risolvi())
      }),
  }
}

interface Filtro {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  [tag: string]: unknown
}

function corrisponde(evento: NostrEvent, filtro: Filtro): boolean {
  if (filtro.ids && !filtro.ids.includes(evento.id)) return false
  if (filtro.authors && !filtro.authors.includes(evento.pubkey)) return false
  if (filtro.kinds && !filtro.kinds.includes(evento.kind)) return false
  if (filtro.since !== undefined && evento.created_at < filtro.since) return false
  if (filtro.until !== undefined && evento.created_at > filtro.until) return false
  for (const [chiave, valore] of Object.entries(filtro)) {
    if (!chiave.startsWith('#') || !Array.isArray(valore)) continue
    const nome = chiave.slice(1)
    const presenti = evento.tags.filter((t) => t[0] === nome).map((t) => t[1])
    if (!valore.some((v) => presenti.includes(v as string))) return false
  }
  return true
}

/** The replacement of replaceables and addressables, as a relay would apply it. */
function memorizza(eventi: NostrEvent[], evento: NostrEvent): string {
  const addressable = evento.kind >= 30000 && evento.kind < 40000
  const replaceable =
    evento.kind === 0 || evento.kind === 3 || (evento.kind >= 10000 && evento.kind < 20000)

  if (addressable || replaceable) {
    const d = evento.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const i = eventi.findIndex(
      (e) =>
        e.kind === evento.kind &&
        e.pubkey === evento.pubkey &&
        (!addressable || (e.tags.find((t) => t[0] === 'd')?.[1] ?? '') === d),
    )
    if (i >= 0) {
      const precedente = eventi[i]
      if (precedente && precedente.created_at > evento.created_at) {
        return 'duplicate: ho gia una versione piu recente'
      }
      eventi.splice(i, 1)
    }
  } else if (eventi.some((e) => e.id === evento.id)) {
    return 'duplicate: already have this event'
  }

  eventi.push(evento)
  return ''
}
