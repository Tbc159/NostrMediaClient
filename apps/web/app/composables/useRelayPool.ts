import type { RelayPool } from '@nmc/nostr-core'

/**
 * Accesso al pool di relay.
 *
 * Restituisce `null` in SSR invece di lanciare: le pagine pubbliche possono
 * essere renderizzate lato server senza toccare i relay, e chi legge dai relay
 * lo fa comunque dentro `onMounted`.
 */
export function useRelayPool(): RelayPool | null {
  if (!import.meta.client) return null
  const { $relayPool } = useNuxtApp()
  return ($relayPool as RelayPool | undefined) ?? null
}
