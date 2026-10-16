import type { RelayPool } from '@nmc/nostr-core'

/**
 * Access to the relay pool.
 *
 * It returns `null` in SSR instead of throwing: the public pages can be
 * rendered on the server side without touching the relays, and whoever reads
 * from the relays does so inside `onMounted` anyway.
 */
export function useRelayPool(): RelayPool | null {
  if (!import.meta.client) return null
  const { $relayPool } = useNuxtApp()
  return ($relayPool as RelayPool | undefined) ?? null
}
