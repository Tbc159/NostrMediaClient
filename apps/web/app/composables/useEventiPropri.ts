import type { Filtro, NostrEvent } from '@nmc/nostr-core'

export interface OpzioniEventiPropri {
  limite?: number
  timeoutMs?: number
  /** Filtro aggiuntivo, unito a quello per autore. */
  extra?: Partial<Filtro>
}

/**
 * Legge dai relay i soli eventi pubblicati dall'identita' attiva.
 *
 * Tutte le sezioni che mostrano eventi passano di qui. La scelta e' netta e va
 * detta: senza la lista dei follow (kind 3) e senza il modello outbox
 * (NIP-65), un elenco "di tutti" sarebbe in realta' *quello che passa dai relay
 * configurati* — cioe' una fetta arbitraria della rete, diversa a ogni
 * ricarica. Mostrare solo i propri eventi e' un insieme che l'utente riconosce
 * e sa spiegarsi.
 *
 * Senza identita' non si interroga affatto: un filtro con `authors: []` viene
 * interpretato da molti relay come "nessun autore", quindi restituirebbe il
 * vuoto dopo aver aperto le connessioni per niente.
 */
export function useEventiPropri(kinds: number[], opzioni: OpzioniEventiPropri = {}) {
  const identita = useIdentity()

  const timeline = useTimeline(
    (): Filtro => ({
      kinds,
      authors: identita.pubkey ? [identita.pubkey] : [],
      limit: opzioni.limite ?? 100,
      ...(opzioni.extra ?? {}),
    }),
    {
      immediato: false,
      ...(opzioni.timeoutMs !== undefined ? { timeoutMs: opzioni.timeoutMs } : {}),
    },
  )

  async function carica(): Promise<void> {
    if (!identita.pubkey) {
      timeline.eventi.value = []
      return
    }
    await timeline.carica()
  }

  onMounted(carica)
  // Cambiando identita' l'elenco deve seguire, non restare quello di prima.
  watch(() => identita.pubkey, carica)

  const eventi = computed<NostrEvent[]>(() => timeline.eventi.value)
  const senzaIdentita = computed(() => !identita.pubkey)

  return { ...timeline, eventi, senzaIdentita, carica }
}
