import { resolveClientConfig, type ClientConfig } from '@nmc/nostr-core'

/**
 * Colla fra il runtimeConfig di Nuxt e la validazione del core.
 *
 * Nuxt mappa `NUXT_PUBLIC_DEFAULT_READ_RELAYS` su `runtimeConfig.public.defaultReadRelays`,
 * mentre `resolveClientConfig` ragiona sui nomi delle variabili d'ambiente:
 * qui si ricostruisce quella forma, cosi' la validazione resta una sola,
 * condivisa fra app, SSR e script da riga di comando.
 *
 * @throws se la configurazione e' malformata. E' voluto: meglio fallire subito
 *         che scoprire a runtime di parlare con un endpoint sbagliato.
 */
export function useClientConfig(): ClientConfig {
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

/** Raggruppa i relay per URL, annotando i ruoli in cui ciascuno compare. */
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
 * Variante che non lancia: restituisce il valore oppure il messaggio d'errore.
 *
 * Serve alle pagine che devono restare visibili anche con una configurazione
 * rotta — le impostazioni per prime, che sono il posto da cui la si sistema.
 * Far esplodere proprio quella pagina lascerebbe l'utente senza via d'uscita.
 */
export function useClientConfigSafe(): { valore: ClientConfig | null; errore: string | null } {
  try {
    return { valore: useClientConfig(), errore: null }
  } catch (err) {
    return { valore: null, errore: err instanceof Error ? err.message : String(err) }
  }
}
