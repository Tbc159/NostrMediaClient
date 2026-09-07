import { creaServizioAudioLegacy, normalizzaBaseUrl, type ServizioAudio } from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Collegamento al servizio di elaborazione audio.
 *
 * E' un servizio esterno al protocollo, come i relay e Blossom: qui si
 * configura soltanto. L'indirizzo vive nel browser dell'utente, non nel
 * repository.
 *
 * Il predefinito punta al servizio di sviluppo perche' e' l'unico deployato che
 * sappia elaborare audio; resta modificabile, ed e' il primo campo della
 * pagina invece che una costante nascosta.
 */

const CHIAVE_STORAGE = 'nmc.audio'
const PREDEFINITO = 'http://api-v0-bitcoinradio.duckdns.org'

export const useAudio = defineStore('audio', () => {
  const baseUrl = ref(PREDEFINITO)
  const raggiungibile = ref<boolean | null>(null)
  const verificaInCorso = ref(false)

  const configurato = computed(() => normalizzaBaseUrl(baseUrl.value) !== '')

  function carica(): void {
    if (!import.meta.client) return
    try {
      const salvato = localStorage.getItem(CHIAVE_STORAGE)
      if (salvato) baseUrl.value = salvato
    } catch {
      // Storage non disponibile: resta il predefinito.
    }
  }

  function salva(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(CHIAVE_STORAGE, baseUrl.value)
    } catch {
      // La scelta vale per questa sessione soltanto.
    }
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
    raggiungibile,
    verificaInCorso,
    configurato,
    servizio,
    ostacoli,
    carica,
    salva,
    verifica,
  }
})
