import { RelayPool, type Relay, type RelayOptions } from 'applesauce-relay'

/**
 * The pool of relay connections.
 *
 * **It must be created per context, never at module level.** A module
 * singleton on Node would be shared between every SSR request of every user:
 * the connections, and with them any NIP-42 authentication, would carry from
 * one session to another. In the browser the problem does not arise, but the
 * rule stays single so nobody has to remember when it applies.
 *
 * The lifecycle belongs to the caller: `pool.close()` closes everything.
 */
export function createRelayPool(options?: RelayOptions): RelayPool {
  return new RelayPool({
    // Relays stay connected for a while after the last subscription:
    // navigating between screens reuses the same connection instead of
    // redoing the TLS and WebSocket handshake on every page change.
    keepAlive: 60_000,
    ...options,
  })
}

export type { Relay, RelayPool, RelayOptions }

/** Normalises a relay URL so it can be compared with others. */
export function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Merges several relay lists, dropping duplicates.
 *
 * It is needed more often than it looks: reading from the read relays *and*
 * the write relays is normal, but querying the same URL twice means doubling
 * the traffic and, on some relays, getting rate-limited.
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
