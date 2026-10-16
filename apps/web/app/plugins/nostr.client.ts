import { createRelayPool, type RelayPool } from '@nmc/nostr-core'

/**
 * The pool of connections to the relays, created once per browser session.
 *
 * The `.client` suffix is not a detail: it is the security rule from section 4
 * of the plan. On Node a module-level pool would be shared between every SSR
 * request of every user, and with it any NIP-42 authentications — one user's
 * session would end up inside another's. Here the pool is born in the browser,
 * lives as long as the tab and dies with it.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const pool = createRelayPool()

  // Closing the connections when the app unmounts keeps a hot reload in
  // development from leaving orphaned WebSockets to every relay behind it.
  nuxtApp.hook('app:beforeMount', () => {
    window.addEventListener('beforeunload', () => pool.close(), { once: true })
  })

  return {
    provide: { relayPool: pool as RelayPool },
  }
})
