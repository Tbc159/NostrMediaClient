import type { Filtro, NostrEvent } from '@nmc/nostr-core'

export interface OpzioniEventiPropri {
  limite?: number
  timeoutMs?: number
  /** An extra filter, merged with the one by author. */
  extra?: Partial<Filtro>
}

/**
 * Reads from the relays the events published by the active identity alone.
 *
 * Every section that shows events goes through here. The choice is a firm one
 * and worth stating: without the follow list (kind 3) and without the outbox
 * model (NIP-65), a list "of everyone" would really be *whatever passes
 * through the configured relays* — that is, an arbitrary slice of the network,
 * different on every reload. Showing your own events alone is a set the user
 * recognises and can explain to themselves.
 *
 * Without an identity nothing is queried at all: a filter with `authors: []`
 * is read by many relays as "no author", so it would return nothing after
 * opening the connections for no reason.
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
  // When the identity changes the list has to follow, not stay as it was.
  watch(() => identita.pubkey, carica)

  const eventi = computed<NostrEvent[]>(() => timeline.eventi.value)
  const senzaIdentita = computed(() => !identita.pubkey)

  return { ...timeline, eventi, senzaIdentita, carica }
}
