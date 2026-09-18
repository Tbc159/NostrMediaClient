import type { NostrEvent } from '@nmc/nostr-core'

export interface EsitoRidistribuzione {
  id: string
  etichetta: string
  /** Relay che ora hanno l'evento: accettato adesso o gia' presente. */
  su: number
  totale: number
  /** `host (motivo)` per ciascun relay che non l'ha preso. */
  rifiutati: string[]
}

/**
 * Rimanda eventi gia' firmati a **tutti** i relay di scrittura.
 *
 * Non e' una nuova pubblicazione: l'evento e' lo stesso, con la stessa firma,
 * e i relay che ce l'hanno gia' rispondono «duplicato», che qui conta come
 * successo. Serve quando un evento e' finito su un relay solo — perche' gli
 * altri erano giu', o perche' la strategia di allora era «il primo che
 * accetta» — e chi legge da altrove, il servizio del feed per primo, non lo
 * trova. La scheda del podcast e gli episodi sono il caso tipico: modificati
 * da un browser con una configurazione, letti da un servizio con un'altra.
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
      // Uno alla volta: l'esito per relay e' per evento, e mescolarli lo
      // renderebbe illeggibile. Sono pochi eventi, non una migrazione.
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

  /** Riassunto in una riga per un esito: «ora su 3 relay; rifiutato da …». */
  const riga = (e: EsitoRidistribuzione): string =>
    `ora su ${e.su} relay su ${e.totale}` +
    (e.rifiutati.length ? `; non su ${e.rifiutati.join(', ')}` : '')

  return { inCorso, esiti, errore, ridistribuisci, riga }
}
