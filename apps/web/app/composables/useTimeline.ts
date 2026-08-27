import { loadTimeline, type Filtro, type NostrEvent } from '@nmc/nostr-core'

export interface OpzioniTimeline {
  /** Relay da interrogare. Predefiniti: quelli di lettura configurati. */
  relays?: readonly string[]
  /** Se caricare subito al montaggio. */
  immediato?: boolean
  timeoutMs?: number
}

/**
 * Legge una timeline dai relay.
 *
 * Non usa `useAsyncData`: quel meccanismo serializza il risultato nel payload
 * SSR, e qui gli eventi arrivano da WebSocket che esistono solo nel browser.
 * Il caricamento parte quindi al montaggio, e la pagina resta renderizzabile
 * lato server anche senza dati.
 */
export function useTimeline(
  filtri: Filtro | Filtro[] | (() => Filtro | Filtro[]),
  opzioni: OpzioniTimeline = {},
) {
  const pool = useRelayPool()
  const config = useClientConfig()

  const eventi = ref<NostrEvent[]>([])
  const caricamento = ref(false)
  const errore = ref<string | null>(null)
  /** Istante dell'ultimo caricamento riuscito: senza, non si distingue una timeline vuota da una mai caricata. */
  const ultimaLettura = ref<Date | null>(null)

  const destinazioni = computed(() => opzioni.relays ?? config.readRelays)

  async function carica(): Promise<void> {
    if (!pool) return
    caricamento.value = true
    errore.value = null
    try {
      const f = typeof filtri === 'function' ? filtri() : filtri
      eventi.value = await loadTimeline(pool, destinazioni.value, f, {
        ...(opzioni.timeoutMs !== undefined ? { timeoutMs: opzioni.timeoutMs } : {}),
      })
      ultimaLettura.value = new Date()
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
    } finally {
      caricamento.value = false
    }
  }

  if (opzioni.immediato !== false) onMounted(carica)

  /** Inserisce in cima un evento appena pubblicato, senza rileggere dai relay. */
  function anteponi(evento: NostrEvent): void {
    if (eventi.value.some((e) => e.id === evento.id)) return
    eventi.value = [evento, ...eventi.value]
  }

  return { eventi, caricamento, errore, ultimaLettura, destinazioni, carica, anteponi }
}
