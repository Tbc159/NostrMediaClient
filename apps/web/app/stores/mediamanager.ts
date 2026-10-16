import {
  creaClientMediaManager,
  creaServizioAudio,
  normalizzaBaseUrl,
  type ClientMediaManager,
  type ServizioAudio,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * The connection to the media-manager microservice.
 *
 * It is a service outside the protocol: it has nothing of Nostr about it, it
 * processes content and keeps an archive of its own. As with the relays and
 * with Blossom, **here it is only configured, and the configuration lives in
 * the settings**: the Audio page shows only what the service can do.
 *
 * **One address only.** The archive and the audio processing are domains of
 * the same microservice: the audio used to live elsewhere and had a
 * configuration of its own, not any more.
 *
 * The address and the key come from the environment (`.env`), already set to
 * what works, and stay replaceable by the user. The replacement lives in their
 * browser, not in the repository.
 *
 * **The key is kept in the clear.** It is not an identity and signs nothing:
 * it opens a processing service. It remains a credential, though, and the
 * interface says so instead of leaving it to be inferred.
 */

const CHIAVE_STORAGE = 'nmc.mediamanager'

interface Persistito {
  /** Present only when the user has replaced the environment's default. */
  baseUrl?: string
  apiKey?: string
}

export interface DefaultMediaManager {
  baseUrl: string
  apiKey: string
}

export const useMediaManager = defineStore('mediamanager', () => {
  const predefiniti = ref<DefaultMediaManager>({ baseUrl: '', apiKey: '' })
  const override = ref<Persistito>({})

  const baseUrl = computed(() => override.value.baseUrl ?? predefiniti.value.baseUrl)
  const apiKey = computed(() => override.value.apiKey ?? predefiniti.value.apiKey)

  /** The health per domain: `null` until it has been checked. */
  const salute = ref<{ media: boolean; content: boolean; audio: boolean } | null>(null)
  const verificaInCorso = ref(false)

  const configurato = computed(() => normalizzaBaseUrl(baseUrl.value) !== '')
  const personalizzato = computed(
    () => override.value.baseUrl !== undefined || override.value.apiKey !== undefined,
  )

  function inizializza(daAmbiente: DefaultMediaManager): void {
    predefiniti.value = daAmbiente
    if (!import.meta.client) return
    try {
      const grezzo = localStorage.getItem(CHIAVE_STORAGE)
      if (!grezzo) return
      const dati = JSON.parse(grezzo) as Persistito
      const letto: Persistito = {}
      if (dati.baseUrl) letto.baseUrl = dati.baseUrl
      if (dati.apiKey) letto.apiKey = dati.apiKey
      override.value = letto
    } catch {
      // Storage unavailable or data corrupted: the environment's defaults remain.
    }
  }

  function persisti(): void {
    if (!import.meta.client) return
    try {
      if (!personalizzato.value) localStorage.removeItem(CHIAVE_STORAGE)
      else localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(override.value))
    } catch {
      // The configuration holds for this session alone.
    }
  }

  /**
   * Replaces the address and the key. An empty field means **go back to the
   * environment's default**, not «no value»: otherwise emptying the key by
   * mistake would leave the service mute with no way to remedy it short of
   * writing the key out again from memory.
   */
  function applica(modifiche: DefaultMediaManager): void {
    const prossimo: Persistito = {}
    const url = modifiche.baseUrl.trim()
    const chiave = modifiche.apiKey.trim()
    if (url !== '' && url !== predefiniti.value.baseUrl) prossimo.baseUrl = url
    if (chiave !== '' && chiave !== predefiniti.value.apiKey) prossimo.apiKey = chiave
    override.value = prossimo
    salute.value = null
    persisti()
  }

  function ripristina(): void {
    override.value = {}
    salute.value = null
    persisti()
  }

  /** The client, or `null` when the address is missing. Recreated when the configuration changes. */
  const client = computed<ClientMediaManager | null>(() => {
    if (!configurato.value) return null
    try {
      return creaClientMediaManager({
        baseUrl: baseUrl.value,
        ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      })
    } catch {
      return null
    }
  })

  /**
   * The audio domain's client, on the same address and with the same key.
   *
   * It sits in a separate object because it is a distinct domain of the
   * contract, not because it is another installation to configure.
   */
  const audio = computed<ServizioAudio | null>(() => {
    if (!configurato.value) return null
    try {
      return creaServizioAudio({
        baseUrl: baseUrl.value,
        ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      })
    } catch {
      return null
    }
  })

  async function verifica(): Promise<void> {
    const c = client.value
    if (!c) {
      salute.value = null
      return
    }
    verificaInCorso.value = true
    try {
      const [media, content, audioOk] = await Promise.all([
        c.salute('media'),
        c.salute('content'),
        c.salute('audio'),
      ])
      salute.value = { media, content, audio: audioOk }
    } finally {
      verificaInCorso.value = false
    }
  }

  /**
   * The obstacles that keep the browser from talking to the service,
   * independently of the service itself.
   *
   * They are worth computing and showing: they are two faults that from the
   * browser present themselves as «it does not answer», sending you to look
   * for the problem where it is not. Mixed content can be recognised for
   * certain; the absence of CORS cannot, so it is named only as a probable
   * cause.
   */
  const ostacoli = computed<string[]>(() => {
    const problemi: string[] = []
    if (!import.meta.client || !configurato.value) return problemi

    const indirizzo = normalizzaBaseUrl(baseUrl.value)
    if (location.protocol === 'https:' && indirizzo.startsWith('http://')) {
      problemi.push(
        'Questa pagina è servita su https e il servizio su http: il browser blocca la richiesta ' +
          'come contenuto misto, prima ancora di inviarla. Serve https sul servizio.',
      )
    }
    return problemi
  })

  return {
    baseUrl,
    apiKey,
    predefiniti,
    personalizzato,
    salute,
    verificaInCorso,
    configurato,
    client,
    audio,
    ostacoli,
    inizializza,
    applica,
    ripristina,
    verifica,
  }
})
