import { creaClientMediaManager, normalizzaBaseUrl, type ClientMediaManager } from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Collegamento al microservizio media-manager.
 *
 * E' un servizio esterno al protocollo: non ha nulla di Nostr, elabora
 * contenuti e tiene un proprio archivio. Come per i relay e per Blossom, qui
 * si configura soltanto — l'indirizzo e la chiave restano scelte dell'utente e
 * vivono nel suo browser, non nel repository.
 *
 * **La chiave e' conservata in chiaro.** Non e' un'identita' e non firma
 * nulla: apre un servizio di elaborazione. Resta pero' una credenziale, e
 * l'interfaccia lo dice invece di lasciarlo intendere.
 */

const CHIAVE_STORAGE = 'nmc.mediamanager'

interface Persistito {
  baseUrl: string
  apiKey: string
}

export const useMediaManager = defineStore('mediamanager', () => {
  const baseUrl = ref('')
  const apiKey = ref('')
  /** Salute per dominio: `null` finche' non si e' verificato. */
  const salute = ref<{ media: boolean; content: boolean } | null>(null)
  const verificaInCorso = ref(false)

  const configurato = computed(() => normalizzaBaseUrl(baseUrl.value) !== '')

  function carica(): void {
    if (!import.meta.client) return
    try {
      const grezzo = localStorage.getItem(CHIAVE_STORAGE)
      if (!grezzo) return
      const dati = JSON.parse(grezzo) as Persistito
      baseUrl.value = dati.baseUrl ?? ''
      apiKey.value = dati.apiKey ?? ''
    } catch {
      // Storage non disponibile o dato corrotto: si riparte non configurati.
    }
  }

  function salva(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(
        CHIAVE_STORAGE,
        JSON.stringify({ baseUrl: baseUrl.value, apiKey: apiKey.value }),
      )
    } catch {
      // La configurazione vale per questa sessione soltanto.
    }
  }

  function dimentica(): void {
    baseUrl.value = ''
    apiKey.value = ''
    salute.value = null
    if (import.meta.client) {
      try {
        localStorage.removeItem(CHIAVE_STORAGE)
      } catch {
        // niente da fare
      }
    }
  }

  /** Il client, oppure `null` se manca l'indirizzo. Ricreato quando cambia la configurazione. */
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

  async function verifica(): Promise<void> {
    const c = client.value
    if (!c) {
      salute.value = null
      return
    }
    verificaInCorso.value = true
    try {
      const [media, content] = await Promise.all([c.salute('media'), c.salute('content')])
      salute.value = { media, content }
    } finally {
      verificaInCorso.value = false
    }
  }

  /**
   * Ostacoli che impediscono al browser di parlare col servizio, indipendenti
   * dal servizio stesso.
   *
   * Vale la pena calcolarli e mostrarli: sono due guasti che dal browser si
   * manifestano come «non risponde», mandando a cercare il problema dove non
   * e'. Il contenuto misto si riconosce con certezza; l'assenza di CORS no,
   * quindi si nomina soltanto come causa probabile.
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
    salute,
    verificaInCorso,
    configurato,
    client,
    ostacoli,
    carica,
    salva,
    dimentica,
    verifica,
  }
})
