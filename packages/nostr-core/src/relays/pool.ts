import { RelayPool, type Relay, type RelayOptions } from 'applesauce-relay'

/**
 * Pool di connessioni ai relay.
 *
 * **Va creato per contesto, mai a livello di modulo.** Un singleton di modulo
 * su Node sarebbe condiviso fra tutte le richieste SSR di tutti gli utenti: le
 * connessioni, e con esse eventuali autenticazioni NIP-42, passerebbero da una
 * sessione all'altra. Nel browser il problema non si pone, ma la regola resta
 * unica per non doverla ricordare a tratti.
 *
 * Il ciclo di vita e' del chiamante: `pool.close()` chiude tutto.
 */
export function createRelayPool(options?: RelayOptions): RelayPool {
  return new RelayPool({
    // I relay restano connessi un po' dopo l'ultima sottoscrizione: navigando
    // fra le schermate si riusa la stessa connessione invece di rifare
    // handshake TLS e WebSocket a ogni cambio di pagina.
    keepAlive: 60_000,
    ...options,
  })
}

export type { Relay, RelayPool, RelayOptions }

/** Normalizza un URL di relay per confrontarlo con altri. */
export function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Unisce piu' liste di relay togliendo i doppioni.
 *
 * Serve piu' spesso di quanto sembri: leggere dai relay di lettura *e* da
 * quelli di scrittura e' normale, ma interrogare due volte lo stesso URL
 * significa raddoppiare il traffico e, su alcuni relay, farsi limitare per
 * eccesso di richieste.
 */
export function mergeRelayLists(...liste: readonly (readonly string[])[]): string[] {
  const visti = new Set<string>()
  const risultato: string[] = []
  for (const lista of liste) {
    for (const url of lista) {
      const chiave = normalizeRelayUrl(url)
      if (chiave.length === 0 || visti.has(chiave)) continue
      visti.add(chiave)
      risultato.push(url)
    }
  }
  return risultato
}
