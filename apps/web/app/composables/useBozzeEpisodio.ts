import {
  creaBozzaEpisodio,
  leggiBozzaEpisodio,
  type BozzaEpisodio,
  type DatiBozzaEpisodio,
} from '@nmc/nostr-core'

/**
 * Episode drafts, saved in the browser.
 *
 * A draft carries the form's data and the files already on Blossom: what is
 * missing — the description, an image not yet uploaded — is filled in later,
 * without redoing the rest. It lives in this browser: to take it with you
 * there is the exportable proposal, which is the same object written to a
 * file.
 *
 * The same scheme as `useBozzeLocali` (articles), which stays separate: the
 * two drafts have different shapes and no reason to share a storage key.
 */

const CHIAVE = 'nmc.bozze-episodio'

function leggiTutte(): BozzaEpisodio[] {
  if (!import.meta.client) return []
  try {
    const grezzo = localStorage.getItem(CHIAVE)
    const dati = grezzo ? (JSON.parse(grezzo) as unknown[]) : []
    if (!Array.isArray(dati)) return []
    // One unreadable draft must not make the others disappear.
    return dati.flatMap((d) => {
      try {
        return [leggiBozzaEpisodio(JSON.stringify(d))]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function useBozzeEpisodio() {
  const bozze = ref<BozzaEpisodio[]>([])

  function ricarica(): void {
    bozze.value = leggiTutte().sort((a, b) => b.aggiornataAlle - a.aggiornataAlle)
  }

  function scrivi(tutte: BozzaEpisodio[]): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(CHIAVE, JSON.stringify(tutte))
    } catch {
      // Storage full: the draft stays in the open form all the same.
    }
    bozze.value = tutte.sort((a, b) => b.aggiornataAlle - a.aggiornataAlle)
  }

  /** Saves, replacing the draft with the same id. Returns the saved one. */
  function salva(dati: DatiBozzaEpisodio): BozzaEpisodio {
    const bozza = creaBozzaEpisodio(dati)
    const altre = leggiTutte().filter((b) => b.id !== bozza.id)
    scrivi([...altre, bozza])
    return bozza
  }

  function trova(id: string): BozzaEpisodio | null {
    return leggiTutte().find((b) => b.id === id) ?? null
  }

  function elimina(id: string): void {
    scrivi(leggiTutte().filter((b) => b.id !== id))
  }

  onMounted(ricarica)

  return { bozze, ricarica, salva, trova, elimina }
}
