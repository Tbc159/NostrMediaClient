import { loadEventById, loadReplaceable, type NostrEvent } from '@nmc/nostr-core'

/**
 * Fetches an already published event from the relays, to reopen it in a form.
 *
 * Two ways of addressing it, which are not interchangeable:
 *
 *  - by **coordinate** (kind + author + `d` tag) for the replaceable events.
 *    It is the only correct way: the id changes on every rewrite, the
 *    coordinate does not, and it is the coordinate that tells the relay which
 *    version to replace.
 *  - by **id** for the regular events, which have no coordinate and of which
 *    only a copy can be recomposed.
 *
 * It reads from the relays and not from a local cache: an edit made by another
 * client would not be here, and republishing from an old version would delete
 * it silently.
 */
export function useEventoEsistente() {
  const pool = useRelayPool()
  const identita = useIdentity()
  const config = useClientConfig()

  const evento = ref<NostrEvent | null>(null)
  const caricamento = ref(false)
  const errore = ref<string | null>(null)

  /** The read relays plus the write ones: it is on the latter that the event ended up. */
  const sorgenti = computed(() => [...config.value.readRelays, ...config.value.writeRelays])

  /**
   * The latest version of a replaceable/addressable.
   *
   * As a rule the active identity's; `autore` looks for it on another key —
   * which is needed when preparing an event somebody else will sign by
   * delegation, and the version to edit is theirs, not your own.
   */
  async function perCoordinata(
    kind: number,
    identificatore?: string,
    autore?: string,
  ): Promise<NostrEvent | null> {
    const pubkey = autore ?? identita.pubkey
    if (!pool || !pubkey) return null
    caricamento.value = true
    errore.value = null
    try {
      const trovato = await loadReplaceable(
        pool,
        sorgenti.value,
        {
          kind,
          pubkey,
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
