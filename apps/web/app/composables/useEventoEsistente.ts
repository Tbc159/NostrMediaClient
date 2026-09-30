import { loadEventById, loadReplaceable, relayPerLeggere, type NostrEvent } from '@nmc/nostr-core'

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

  /**
   * I relay da interrogare per un kind: i propri, piu' gli indicizzatori
   * dove ha senso (profilo, liste). Un profilo che i relay di contenuto hanno
   * lasciato cadere resta spesso solo li'.
   */
  const sorgenti = (kind: number): string[] => relayPerLeggere(kind, config.value)

  /**
   * L'ultima versione di un replaceable/addressable.
   *
   * Di norma quella dell'identita' attiva; `autore` la cerca su un'altra
   * chiave — serve quando si prepara un evento che firmera' qualcun altro per
   * delega, e la versione da modificare e' la sua, non la propria.
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
        sorgenti(kind),
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
      // Per id non si sa il kind prima di averlo letto: si chiede ai propri
      // relay, che e' dove un evento regolare puo' stare.
      const trovato = await loadEventById(pool, sorgenti(1), id, { timeoutMs: 8000 })
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
