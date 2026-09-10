import {
  creaClientMediaManager,
  creaServizioAudio,
  normalizzaBaseUrl,
  type ClientMediaManager,
  type ServizioAudio,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Collegamento al microservizio media-manager.
 *
 * E' un servizio esterno al protocollo: non ha nulla di Nostr, elabora
 * contenuti e tiene un proprio archivio. Come per i relay e per Blossom, **qui
 * si configura soltanto, e la configurazione sta nelle impostazioni**: le
 * pagine Elabora e Audio mostrano solo cosa il servizio sa fare.
 *
 * **Un indirizzo solo, per tutto.** Immagini, archivio ed elaborazione audio
 * sono tre domini dello stesso microservizio: prima l'audio stava altrove e
 * aveva una configurazione sua, ora non piu'.
 *
 * Indirizzo e chiave arrivano dall'ambiente (`.env`), gia' valorizzati su cio'
 * che funziona, e restano sostituibili dall'utente. La sostituzione vive nel
 * suo browser, non nel repository.
 *
 * **La chiave e' conservata in chiaro.** Non e' un'identita' e non firma
 * nulla: apre un servizio di elaborazione. Resta pero' una credenziale, e
 * l'interfaccia lo dice invece di lasciarlo intendere.
 */

const CHIAVE_STORAGE = 'nmc.mediamanager'

interface Persistito {
  /** Presenti solo se l'utente ha sostituito il default d'ambiente. */
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

  /** Salute per dominio: `null` finche' non si e' verificato. */
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
      // Storage non disponibile o dato corrotto: restano i default d'ambiente.
    }
  }

  function persisti(): void {
    if (!import.meta.client) return
    try {
      if (!personalizzato.value) localStorage.removeItem(CHIAVE_STORAGE)
      else localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(override.value))
    } catch {
      // La configurazione vale per questa sessione soltanto.
    }
  }

  /**
   * Sostituisce indirizzo e chiave. Un campo vuoto significa **torna al
   * default d'ambiente**, non «nessun valore»: altrimenti svuotare la chiave
   * per sbaglio lascerebbe il servizio muto senza modo di rimediare se non
   * riscrivendola a memoria.
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

  /**
   * Client del dominio audio, sullo stesso indirizzo e con la stessa chiave.
   *
   * Sta in un oggetto separato perche' e' un dominio distinto del contratto,
   * non perche' sia un'altra installazione da configurare.
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
