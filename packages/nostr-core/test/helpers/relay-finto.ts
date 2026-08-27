import { WebSocketServer, type WebSocket } from 'ws'

import type { NostrEvent } from '../../src/kinds/types.js'

/**
 * Relay NIP-01 minimo, in-process, per i test di integrazione.
 *
 * Serve a provare il percorso completo — WebSocket, EVENT, OK, REQ, EOSE —
 * senza dipendere da un relay pubblico. Un mock del pool proverebbe solo che
 * il nostro codice chiama se stesso; qui passa davvero dalla rete, e con essa
 * dai casi che contano: risposte negative, sostituzione degli addressable,
 * duplicati.
 *
 * Non e' un relay: non verifica firme, non applica limiti, non persiste.
 */
export type ModoRelay =
  | { tipo: 'accetta' }
  | { tipo: 'rifiuta'; messaggio: string }
  /** Non risponde mai all'EVENT: simula un relay che accetta la connessione e tace. */
  | { tipo: 'muto' }

export interface RelayFinto {
  url: string
  eventi: NostrEvent[]
  chiudi(): Promise<void>
}

export async function avviaRelayFinto(modo: ModoRelay = { tipo: 'accetta' }): Promise<RelayFinto> {
  const eventi: NostrEvent[] = []
  // Porta 0: il sistema ne assegna una libera, cosi' i test possono girare in
  // parallelo senza collidere.
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((risolvi) => wss.once('listening', risolvi))
  const porta = (wss.address() as { port: number }).port

  wss.on('connection', (ws: WebSocket) => {
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
        return
      }

      if (tipo === 'CLOSE') ws.send(JSON.stringify(['CLOSED', messaggio[1], '']))
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

/** Sostituzione di replaceable e addressable, come la applicherebbe un relay. */
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
