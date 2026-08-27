/**
 * Bozze di articolo, salvate nel browser.
 *
 * Perche' locali e non su un relay: NIP-23 **dichiara deprecato il kind 30024**
 * e rimanda a NIP-37, che cifra la bozza con NIP-44 verso se stessi. Il 30024
 * andrebbe invece sul relay *in chiaro*, e chiamarlo "bozza" e' fuorviante —
 * e' un articolo pubblicato in un posto poco frequentato, leggibile da
 * chiunque abbia accesso a quel relay.
 *
 * Finche' NIP-37 non e' implementato, il browser e' l'unico posto dove una
 * bozza resta davvero privata. Il prezzo, che va detto, e' che non segue
 * l'utente su un altro dispositivo.
 */

const CHIAVE = 'nmc.bozze-articolo'

export interface BozzaArticolo {
  identifier: string
  title: string
  summary: string
  image: string
  hashtag: string
  content: string
  /** Prima pubblicazione, se l'articolo era gia' uscito. */
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
      // Storage pieno: la bozza resta comunque nel form aperto.
    }
    bozze.value = tutte.sort((a, b) => b.salvataAlle - a.salvataAlle)
  }

  /** Salva sostituendo la bozza con lo stesso identificatore. */
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
