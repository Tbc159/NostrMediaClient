import { loadTimeline, type Filtro, type NostrEvent } from '@nmc/nostr-core'

export interface OpzioniTimeline {
  /** Relay da interrogare. Predefiniti: quelli di lettura configurati. */
  relays?: readonly string[]
  /** Se caricare subito al montaggio. */
  immediato?: boolean
  timeoutMs?: number
}

/**
 * Reads a timeline from the relays.
 *
 * It does not use `useAsyncData`: that mechanism serialises the result into
 * the SSR payload, and here the events come from WebSockets that exist only in
 * the browser. The loading therefore starts on mount, and the page stays
 * renderable on the server side even without data.
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
  /** The instant of the last successful load: without it an empty timeline cannot be told from one never loaded. */
  const ultimaLettura = ref<Date | null>(null)

  const destinazioni = computed(() => opzioni.relays ?? config.value.readRelays)

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

  /** Puts a just-published event at the top, without re-reading from the relays. */
  function anteponi(evento: NostrEvent): void {
    if (eventi.value.some((e) => e.id === evento.id)) return
    eventi.value = [evento, ...eventi.value]
  }

  return { eventi, caricamento, errore, ultimaLettura, destinazioni, carica, anteponi }
}
