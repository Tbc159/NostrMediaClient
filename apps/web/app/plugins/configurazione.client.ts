import { useConfigurazione } from '~/stores/configurazione'

/**
 * Carica gli endpoint scelti dall'utente prima che le pagine li leggano.
 *
 * Deve girare qui e non in un `onMounted`: i composable che pubblicano e
 * leggono risolvono i relay al momento del setup, e se lo storage venisse
 * letto dopo, la prima operazione di ogni sessione partirebbe con i default
 * dell'ambiente invece che con la configurazione dell'utente.
 */
export default defineNuxtPlugin(() => {
  const { public: pub } = useRuntimeConfig()
  useConfigurazione().inizializza({
    NUXT_PUBLIC_DEFAULT_READ_RELAYS: String(pub.defaultReadRelays ?? ''),
    NUXT_PUBLIC_DEFAULT_WRITE_RELAYS: String(pub.defaultWriteRelays ?? ''),
    NUXT_PUBLIC_INDEXER_RELAYS: String(pub.indexerRelays ?? ''),
    NUXT_PUBLIC_DRAFT_RELAY: String(pub.draftRelay ?? ''),
    NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS: String(pub.defaultBlossomServers ?? ''),
    NUXT_PUBLIC_SITE_URL: String(pub.siteUrl ?? ''),
    NUXT_PUBLIC_NJUMP_URL: String(pub.njumpUrl ?? ''),
  })
})
