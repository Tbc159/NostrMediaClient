import type { NostrEvent } from '@nmc/nostr-core'

export interface EsitoRidistribuzione {
  id: string
  etichetta: string
  /** The relays that now have the event: accepted just now, or there already. */
  su: number
  totale: number
  /** `host (reason)` for each relay that did not take it. */
  rifiutati: string[]
}

/**
 * Sends already signed events again to **every** write relay.
 *
 * It is not a new publication: the event is the same, with the same signature,
 * and the relays that have it already answer «duplicate», which counts as a
 * success here. It is needed when an event has ended up on a single relay —
 * because the others were down, or because the strategy at the time was «the
 * first that accepts» — and whoever reads from elsewhere, the feed's service
 * first of all, does not find it. The podcast's card and the episodes are the
 * typical case: edited from a browser with one configuration, read by a
 * service with another.
 */
export function useRidistribuzione() {
  const invio = usePublish()
  const inCorso = ref(false)
  const esiti = ref<EsitoRidistribuzione[]>([])
  const errore = ref<string | null>(null)

  async function ridistribuisci(
    eventi: readonly { evento: NostrEvent; etichetta: string }[],
  ): Promise<void> {
    inCorso.value = true
    errore.value = null
    esiti.value = []
    try {
      // One at a time: the outcome per relay is per event, and mixing them
      // would make it unreadable. These are a few events, not a migration.
      for (const { evento, etichetta } of eventi) {
        await invio.pubblica(evento, undefined, { strategia: 'tutti' })
        const r = invio.esito.value
        if (!r) {
          errore.value = invio.errore.value ?? 'Invio non riuscito.'
          return
        }
        const ok = r.risultati.filter((x) => x.esito === 'accettato' || x.esito === 'duplicato')
        esiti.value.push({
          id: evento.id,
          etichetta,
          su: ok.length,
          totale: r.risultati.length,
          rifiutati: r.risultati
            .filter((x) => !ok.includes(x))
            .map((x) => `${x.url.replace(/^wss?:\/\//, '')} (${x.motivo})`),
        })
      }
    } finally {
      inCorso.value = false
    }
  }

  /** A one-line summary of an outcome: «ora su 3 relay; rifiutato da …». */
  const riga = (e: EsitoRidistribuzione): string =>
    `ora su ${e.su} relay su ${e.totale}` +
    (e.rifiutati.length ? `; non su ${e.rifiutati.join(', ')}` : '')

  return { inCorso, esiti, errore, ridistribuisci, riga }
}
