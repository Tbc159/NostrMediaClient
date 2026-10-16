/**
 * Article drafts, saved in the browser.
 *
 * Why local and not on a relay: NIP-23 **declares kind 30024 deprecated** and
 * points to NIP-37, which encrypts the draft with NIP-44 to yourself. The
 * 30024 would instead go onto the relay *in the clear*, and calling it a
 * "draft" is misleading — it is an article published in a quiet place,
 * readable by anyone with access to that relay.
 *
 * Until NIP-37 is implemented, the browser is the only place where a draft
 * really stays private. The price, which is worth saying, is that it does not
 * follow the user to another device.
 */

const CHIAVE = 'nmc.bozze-articolo'

export interface BozzaArticolo {
  identifier: string
  title: string
  summary: string
  image: string
  hashtag: string
  content: string
  /** The first publication, when the article had already been out. */
  publishedAt?: number
  salvataAlle: number
}

function leggiTutte(): BozzaArticolo[] {
  if (!import.meta.client) return []
  try {
    const grezzo = localStorage.getItem(CHIAVE)
    const dati = grezzo ? (JSON.parse(grezzo) as BozzaArticolo[]) : []
    return Array.isArray(dati) ? dati : []
  } catch {
    return []
  }
}

export function useBozzeLocali() {
  const bozze = ref<BozzaArticolo[]>([])

  function ricarica(): void {
    bozze.value = leggiTutte().sort((a, b) => b.salvataAlle - a.salvataAlle)
  }

  function scrivi(tutte: BozzaArticolo[]): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(CHIAVE, JSON.stringify(tutte))
    } catch {
      // Storage full: the draft stays in the open form all the same.
    }
    bozze.value = tutte.sort((a, b) => b.salvataAlle - a.salvataAlle)
  }

  /** Saves, replacing the draft with the same identifier. */
  function salva(bozza: Omit<BozzaArticolo, 'salvataAlle'>): void {
    const altre = leggiTutte().filter((b) => b.identifier !== bozza.identifier)
    scrivi([...altre, { ...bozza, salvataAlle: Date.now() }])
  }

  function elimina(identifier: string): void {
    scrivi(leggiTutte().filter((b) => b.identifier !== identifier))
  }

  onMounted(ricarica)

  return { bozze, ricarica, salva, elimina }
}
