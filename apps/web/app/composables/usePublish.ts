import { publishEvent, type NostrEvent, type RisultatoPubblicazione } from '@nmc/nostr-core'

/**
 * Invio di un evento firmato ai relay.
 *
 * Lo stato che espone non e' un booleano "pubblicato": e' l'elenco degli esiti
 * relay per relay. Su Nostr non esiste un momento in cui un evento e'
 * "pubblicato" in assoluto — esistono relay che lo hanno e relay che no, e
 * l'utente ha diritto di vedere quali.
 */
export function usePublish() {
  const pool = useRelayPool()
  const identita = useIdentity()
  const config = useClientConfig()

  const inCorso = ref(false)
  const esito = ref<RisultatoPubblicazione | null>(null)
  const errore = ref<string | null>(null)

  /** Relay di destinazione: quelli di scrittura configurati. */
  const destinazioni = computed(() => config.writeRelays)

  function azzera(): void {
    esito.value = null
    errore.value = null
  }

  /**
   * Pubblica un evento gia' firmato.
   *
   * @returns true se almeno un relay ha accettato l'evento.
   */
  async function pubblica(
    evento: NostrEvent,
    relays: readonly string[] = destinazioni.value,
  ): Promise<boolean> {
    if (!pool) {
      errore.value = 'Il pool di relay non e’ disponibile: ricarica la pagina.'
      return false
    }

    errore.value = null
    inCorso.value = true
    try {
      esito.value = await publishEvent(pool, relays, evento, {
        // L'autenticazione NIP-42 serve solo qui, in scrittura. In lettura
        // rivelerebbe al relay cosa leggi e quando, senza alcun vantaggio.
        auth: { signEvent: (template) => identita.firma(template) },
      })
      return esito.value.riuscita
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inCorso.value = false
    }
  }

  return { inCorso, esito, errore, destinazioni, pubblica, azzera }
}
