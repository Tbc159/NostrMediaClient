import { useConfigurazione } from '~/stores/configurazione'
import { useMediaManager } from '~/stores/mediamanager'

/**
 * Loads the endpoints the user chose before the pages read them.
 *
 * It has to run here and not in an `onMounted`: the composables that publish
 * and read resolve the relays at setup time, and if the storage were read
 * afterwards, the first operation of every session would start with the
 * environment's defaults instead of the user's configuration.
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

  /*
   * The same reason for the processing service, and one more: the Audio page
   * does not ask for an address and a key — if it read the storage by itself
   * in an `onMounted`, the first render would start as though unconfigured and
   * would show the «configure the service» notice to whoever has the service
   * already.
   */
  useMediaManager().inizializza({
    baseUrl: String(pub.mediaManagerUrl ?? ''),
    apiKey: String(pub.mediaManagerApiKey ?? ''),
  })
})
