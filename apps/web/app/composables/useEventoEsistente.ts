import { loadEventById, loadReplaceable, type NostrEvent } from '@nmc/nostr-core'

/**
 * Recupera dai relay un evento gia' pubblicato, per riaprirlo in un form.
 *
 * Due modi di indirizzarlo, che non sono intercambiabili:
 *
 *  - per **coordinata** (kind + autore + tag `d`) per gli eventi sostituibili.
 *    E' l'unico modo corretto: l'id cambia a ogni riscrittura, la coordinata
 *    no, ed e' la coordinata a dire al relay quale versione sostituire.
 *  - per **id** per gli eventi regolari, che non hanno coordinata e di cui si
 *    puo' solo ricomporre una copia.
 *
 * Legge dai relay e non da una cache locale: una modifica fatta da un altro
 * client non sarebbe qui, e ripubblicare partendo da una versione vecchia la
 * cancellerebbe in silenzio.
 */
export function useEventoEsistente() {
  const pool = useRelayPool()
  const identita = useIdentity()
  const config = useClientConfig()

  const evento = ref<NostrEvent | null>(null)
  const caricamento = ref(false)
  const errore = ref<string | null>(null)

  /** Relay di lettura piu' quelli di scrittura: e' su questi ultimi che l'evento e' finito. */
  const sorgenti = computed(() => [...config.value.readRelays, ...config.value.writeRelays])

  async function perCoordinata(kind: number, identificatore?: string): Promise<NostrEvent | null> {
    if (!pool || !identita.pubkey) return null
    caricamento.value = true
    errore.value = null
    try {
      const trovato = await loadReplaceable(
        pool,
        sorgenti.value,
        {
          kind,
          pubkey: identita.pubkey,
          ...(identificatore !== undefined ? { identifier: identificatore } : {}),
        },
        { timeoutMs: 8000 },
      )
      evento.value = trovato
      if (!trovato) {
        errore.value =
          'Nessuna versione pubblicata trovata sui relay configurati. Può essere finita su relay diversi da quelli da cui leggi.'
      }
      return trovato
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      caricamento.value = false
    }
  }

  async function perId(id: string): Promise<NostrEvent | null> {
    if (!pool) return null
    caricamento.value = true
    errore.value = null
    try {
      const trovato = await loadEventById(pool, sorgenti.value, id, { timeoutMs: 8000 })
      evento.value = trovato
      if (!trovato) errore.value = 'Evento non trovato sui relay configurati.'
      return trovato
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      caricamento.value = false
    }
  }

  return { evento, caricamento, errore, perCoordinata, perId }
}
