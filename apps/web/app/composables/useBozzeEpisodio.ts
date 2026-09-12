import {
  creaBozzaEpisodio,
  leggiBozzaEpisodio,
  type BozzaEpisodio,
  type DatiBozzaEpisodio,
} from '@nmc/nostr-core'

/**
 * Bozze di episodio, salvate nel browser.
 *
 * Una bozza porta i dati del form e i file gia' su Blossom: quello che manca
 * — la descrizione, un'immagine non ancora caricata — si colma dopo, senza
 * rifare il resto. Vive in questo browser: per portarsela dietro c'e' la
 * proposta esportabile, che e' lo stesso oggetto scritto su file.
 *
 * Stesso schema di `useBozzeLocali` (articoli), che resta a se': le due bozze
 * hanno forme diverse e nessuna ragione di condividere una chiave di storage.
 */

const CHIAVE = 'nmc.bozze-episodio'

function leggiTutte(): BozzaEpisodio[] {
  if (!import.meta.client) return []
  try {
    const grezzo = localStorage.getItem(CHIAVE)
    const dati = grezzo ? (JSON.parse(grezzo) as unknown[]) : []
    if (!Array.isArray(dati)) return []
    // Una bozza illeggibile non deve far sparire le altre.
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
      // Storage pieno: la bozza resta comunque nel form aperto.
    }
    bozze.value = tutte.sort((a, b) => b.aggiornataAlle - a.aggiornataAlle)
  }

  /** Salva sostituendo la bozza con lo stesso id. Restituisce quella salvata. */
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
