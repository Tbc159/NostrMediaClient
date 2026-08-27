import { resolveClientConfig, type ClientConfig } from '@nmc/nostr-core'
import { useConfigurazione } from '~/stores/configurazione'

/**
 * Endpoint in vigore, reattivi.
 *
 * La sorgente e' lo store `configurazione`: default del `.env` con sopra le
 * scelte dell'utente. Restituisce un `computed` e non un oggetto fisso perche'
 * gli endpoint cambiano mentre l'applicazione gira — chi li ha letti una volta
 * al setup continuerebbe a pubblicare sui relay vecchi anche dopo che l'utente
 * li ha sostituiti dalle impostazioni.
 *
 * @throws se la configurazione non e' valida. E' voluto: meglio fermarsi che
 *         parlare con un endpoint sbagliato. La pagina delle impostazioni usa
 *         `useClientConfigSafe`, perche' e' il posto da cui si rimedia.
 */
export function useClientConfig(): ComputedRef<ClientConfig> {
  const configurazione = useConfigurazione()

  return computed(() => {
    if (configurazione.config) return configurazione.config
    throw new Error(configurazione.errore ?? 'Configurazione degli endpoint non disponibile.')
  })
}

/** Solo i valori dell'ambiente, senza le scelte dell'utente. Per il confronto in UI. */
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
export function useClientConfigSafe(): ComputedRef<{
  valore: ClientConfig | null
  errore: string | null
}> {
  const configurazione = useConfigurazione()
  return computed(() => ({ valore: configurazione.config, errore: configurazione.errore }))
}
