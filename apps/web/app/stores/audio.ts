import { creaServizioAudioLegacy, normalizzaBaseUrl, type ServizioAudio } from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Collegamento al servizio di elaborazione audio.
 *
 * E' un servizio esterno al protocollo, come i relay e Blossom: **qui si
 * configura soltanto, e la configurazione si tocca dalle impostazioni**. La
 * pagina Audio mostra solo cosa il servizio sa fare — un indirizzo chiesto
 * dentro il flusso di lavoro obbligherebbe a rispondere a una domanda di
 * amministrazione per fare una cosa che con l'amministrazione non c'entra.
 *
 * L'indirizzo arriva dall'ambiente (`.env`, vedi `.env.example`) ed e' gia'
 * quello funzionante: chi apre il client non deve scoprirlo. Resta comunque
 * sostituibile, e la sostituzione vive nel browser di chi la fa, non nel
 * repository.
 */

const CHIAVE_STORAGE = 'nmc.audio'

interface Persistito {
  /** Presente solo se l'utente ha sostituito il default d'ambiente. */
  baseUrl?: string
}

export const useAudio = defineStore('audio', () => {
  const predefinito = ref('')
  const override = ref<string | undefined>(undefined)

  const baseUrl = computed(() => override.value ?? predefinito.value)
  const raggiungibile = ref<boolean | null>(null)
  const verificaInCorso = ref(false)

  const configurato = computed(() => normalizzaBaseUrl(baseUrl.value) !== '')
  const personalizzato = computed(() => override.value !== undefined)

  function inizializza(daAmbiente: string): void {
    predefinito.value = daAmbiente
    if (!import.meta.client) return
    try {
      const grezzo = localStorage.getItem(CHIAVE_STORAGE)
      if (!grezzo) return
      const dati = JSON.parse(grezzo) as Persistito
      if (dati.baseUrl) override.value = dati.baseUrl
    } catch {
      // Storage non disponibile o dato corrotto: resta il default d'ambiente.
    }
  }

  function persisti(): void {
    if (!import.meta.client) return
    try {
      if (override.value === undefined) localStorage.removeItem(CHIAVE_STORAGE)
      else localStorage.setItem(CHIAVE_STORAGE, JSON.stringify({ baseUrl: override.value }))
    } catch {
      // La scelta vale per questa sessione soltanto.
    }
  }

  /**
   * Sostituisce l'indirizzo. Vuoto significa **torna al default**, non
   * «nessun servizio»: e' l'unico modo di disfare una modifica senza dover
   * riconoscere e riscrivere a mano l'indirizzo di partenza.
   */
  function applica(indirizzo: string): void {
    const pulito = indirizzo.trim()
    override.value = pulito === '' || pulito === predefinito.value ? undefined : pulito
    raggiungibile.value = null
    persisti()
  }

  function ripristina(): void {
    override.value = undefined
    raggiungibile.value = null
    persisti()
  }

  const servizio = computed<ServizioAudio | null>(() => {
    if (!configurato.value) return null
    try {
      return creaServizioAudioLegacy({ baseUrl: baseUrl.value })
    } catch {
      return null
    }
  })

  async function verifica(): Promise<void> {
    const s = servizio.value
    if (!s) {
      raggiungibile.value = null
      return
    }
    verificaInCorso.value = true
    try {
      raggiungibile.value = await s.disponibile()
    } finally {
      verificaInCorso.value = false
    }
  }

  /**
   * Ostacoli che stanno fra il browser e il servizio, indipendenti dal servizio.
   *
   * Il contenuto misto si riconosce con certezza e va detto prima del
   * tentativo: da una pagina https una richiesta verso http non parte proprio,
   * e l'errore che ne esce parla di rete quando la rete non c'entra.
   */
  const ostacoli = computed<string[]>(() => {
    if (!import.meta.client || !configurato.value) return []
    const indirizzo = normalizzaBaseUrl(baseUrl.value)
    if (location.protocol === 'https:' && indirizzo.startsWith('http://')) {
      return [
        'Questa pagina è servita su https e il servizio su http: il browser blocca la richiesta ' +
          'come contenuto misto, prima ancora di inviarla. In sviluppo funziona da ' +
          'http://localhost; perché funzioni anche dal sito pubblicato serve https sul servizio.',
      ]
    }
    return []
  })

  return {
    baseUrl,
    predefinito,
    personalizzato,
    raggiungibile,
    verificaInCorso,
    configurato,
    servizio,
    ostacoli,
    inizializza,
    applica,
    ripristina,
    verifica,
  }
})
