import {
  publishEvent,
  strategiaPerKind,
  type NostrEvent,
  type RisultatoPubblicazione,
  type StrategiaPubblicazione,
} from '@nmc/nostr-core'
import { useConfigurazione } from '~/stores/configurazione'

/**
 * Sending a signed event to the relays.
 *
 * The state it exposes is not a "published" boolean: it is the list of
 * outcomes relay by relay. On Nostr there is no moment at which an event is
 * "published" in the absolute — there are relays that have it and relays that
 * do not, and the user is entitled to see which.
 */
export function usePublish() {
  const pool = useRelayPool()
  const identita = useIdentity()
  const config = useClientConfig()
  const configurazione = useConfigurazione()

  const inCorso = ref(false)
  /** The relay being contacted right now, to give feedback during the rotation. */
  const tentativo = ref<{ url: string; indice: number; totale: number } | null>(null)
  const esito = ref<RisultatoPubblicazione | null>(null)
  const errore = ref<string | null>(null)

  /** Relay di destinazione: quelli di scrittura configurati. */
  const destinazioni = computed(() => config.value.writeRelays)

  function azzera(): void {
    esito.value = null
    errore.value = null
    tentativo.value = null
  }

  /**
   * Publishes an already signed event.
   *
   * @returns true when at least one relay accepted the event.
   */
  async function pubblica(
    evento: NostrEvent,
    relays: readonly string[] = destinazioni.value,
    opzioni: { strategia?: StrategiaPubblicazione } = {},
  ): Promise<boolean> {
    if (!pool) {
      errore.value = 'Il pool di relay non e’ disponibile: ricarica la pagina.'
      return false
    }

    errore.value = null
    inCorso.value = true
    try {
      esito.value = await publishEvent(pool, relays, evento, {
        // The NIP-42 authentication is needed only here, when writing. When
        // reading it would reveal to the relay what you read and when, with no
        // advantage at all.
        auth: { signEvent: (template) => identita.firma(template) },
        // The user's preference holds for the notes; the profile, the lists,
        // the podcast's card and episodes go to every relay, because whoever
        // looks for them reads from a relay of their own and does not ask us
        // where we put them.
        strategia: opzioni.strategia ?? strategiaPerKind(evento.kind, configurazione.strategia),
        onTentativo: (url, indice, totale) => {
          tentativo.value = { url, indice, totale }
        },
      })
      return esito.value.riuscita
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inCorso.value = false
      tentativo.value = null
    }
  }

  return { inCorso, esito, errore, destinazioni, tentativo, pubblica, azzera }
}
