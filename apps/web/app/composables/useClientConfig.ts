import { resolveClientConfig, type ClientConfig } from '@nmc/nostr-core'
import { useConfigurazione } from '~/stores/configurazione'

/**
 * The endpoints in force, reactive.
 *
 * The source is the `configurazione` store: the `.env` defaults with the
 * user's choices on top. It returns a `computed` and not a fixed object
 * because the endpoints change while the application runs — whoever read them
 * once at setup would go on publishing to the old relays even after the user
 * had replaced them from the settings.
 *
 * @throws when the configuration is not valid. That is deliberate: better to
 *         stop than to talk to the wrong endpoint. The settings page uses
 *         `useClientConfigSafe`, because it is the place you fix it from.
 */
export function useClientConfig(): ComputedRef<ClientConfig> {
  const configurazione = useConfigurazione()

  return computed(() => {
    if (configurazione.config) return configurazione.config
    throw new Error(configurazione.errore ?? 'Configurazione degli endpoint non disponibile.')
  })
}

/** The environment's values alone, without the user's choices. For the comparison in the UI. */
export function envClientConfig(): ClientConfig {
  const { public: pub } = useRuntimeConfig()
  return resolveClientConfig({
    NUXT_PUBLIC_DEFAULT_READ_RELAYS: String(pub.defaultReadRelays ?? ''),
    NUXT_PUBLIC_DEFAULT_WRITE_RELAYS: String(pub.defaultWriteRelays ?? ''),
    NUXT_PUBLIC_INDEXER_RELAYS: String(pub.indexerRelays ?? ''),
    NUXT_PUBLIC_DRAFT_RELAY: String(pub.draftRelay ?? ''),
    NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: String(pub.defaultBlossomServers ?? ''),
    NUXT_PUBLIC_SITE_URL: String(pub.siteUrl ?? ''),
    NUXT_PUBLIC_NJUMP_URL: String(pub.njumpUrl ?? ''),
  })
}

/** Groups the relays by URL, noting the roles each one appears in. */
export function relayRoles(config: ClientConfig): Map<string, string[]> {
  const roles = new Map<string, string[]>()
  const add = (url: string | null, role: string): void => {
    if (!url) return
    roles.set(url, [...(roles.get(url) ?? []), role])
  }

  for (const u of config.readRelays) add(u, 'lettura')
  for (const u of config.writeRelays) add(u, 'scrittura')
  for (const u of config.indexerRelays) add(u, 'indicizzatore')
  add(config.draftRelay, 'bozze')

  return roles
}

/**
 * The variant that does not throw: it returns either the value or the error
 * message.
 *
 * The pages that have to stay visible even with a broken configuration need it
 * — the settings first of all, which are the place you fix it from. Blowing up
 * that very page would leave the user with no way out.
 */
export function useClientConfigSafe(): ComputedRef<{
  valore: ClientConfig | null
  errore: string | null
}> {
  const configurazione = useConfigurazione()
  return computed(() => ({ valore: configurazione.config, errore: configurazione.errore }))
}
