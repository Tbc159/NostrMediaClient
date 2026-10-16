import { defineStore } from 'pinia'

/**
 * Handing a file from one page to another.
 *
 * The processed audio has to reach «Upload to Blossom» without being
 * downloaded and chosen again. A `Blob` does not travel in a query string and
 * must not end up in `localStorage` — it weighs tens of megabytes and is not
 * serialisable. So it sits in memory, in this store, for the length of one
 * navigation: whoever collects it empties it, and a page reload loses it. That
 * is deliberate: the user still has the original file.
 */
export const useConsegna = defineStore('consegna', () => {
  const file = shallowRef<File | null>(null)
  const origine = ref<'audio' | null>(null)

  function deposita(f: File, da: 'audio'): void {
    file.value = f
    origine.value = da
  }

  /** Returns the file and empties: it is handed over once only. */
  function ritira(): { file: File; origine: 'audio' } | null {
    if (!file.value || !origine.value) return null
    const esito = { file: file.value, origine: origine.value }
    file.value = null
    origine.value = null
    return esito
  }

  return { file, origine, deposita, ritira }
})
