import { defineStore } from 'pinia'

/**
 * Passamano di un file fra due pagine.
 *
 * L'audio elaborato deve arrivare a «Carica su Blossom» senza essere
 * scaricato e riscelto. Un `Blob` non passa da una query string e non deve
 * finire in `localStorage` — pesa decine di megabyte e non e' serializzabile.
 * Quindi sta in memoria, in questo store, per il tempo di una navigazione: chi
 * lo ritira lo svuota, e un ricaricamento della pagina lo perde. E' voluto:
 * il file originale ce l'ha ancora l'utente.
 */
export const useConsegna = defineStore('consegna', () => {
  const file = shallowRef<File | null>(null)
  const origine = ref<'audio' | null>(null)

  function deposita(f: File, da: 'audio'): void {
    file.value = f
    origine.value = da
  }

  /** Restituisce il file e svuota: si consegna una volta sola. */
  function ritira(): { file: File; origine: 'audio' } | null {
    if (!file.value || !origine.value) return null
    const esito = { file: file.value, origine: origine.value }
    file.value = null
    origine.value = null
    return esito
  }

  return { file, origine, deposita, ritira }
})
