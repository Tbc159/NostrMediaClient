import {
  chiama,
  confrontaIndirizzoStabile,
  normalizzaBaseUrl,
  podcastMetadataDefinition,
  riassumiFeedPodcast,
  urlFeedPodcast,
  type EsitoIndirizzoStabile,
} from '@nmc/nostr-core'

import { useMediaManager } from '~/stores/mediamanager'

/**
 * Checking the feed's stable address from the browser.
 *
 * It downloads the address the creator wrote and the service's technical one,
 * and says whether they are the same podcast. Three ways it goes wrong, each
 * with its own message, because each has its own fix:
 *
 *   - a redirect: the apps would remember where it lands, the technical
 *     address, and the stable one would be stable no more;
 *   - unreadable from the page: nearly always the intermediary not passing
 *     the CORS header on, which the browser needs and the apps do not;
 *   - another feed: an intermediary pointing at the wrong key, or a cache.
 *
 * `pronto` is what gates showing and handing out the address: same feed, and
 * the feed itself declaring the stable address as its own.
 */

export type StatoIndirizzo = 'da-leggere' | 'assente' | 'in-verifica' | 'verificato' | 'non-valido'

/**
 * @param chiave the podcast's key, when it is not the active identity — a card
 *               edited through a delegation.
 */
export function useIndirizzoStabile(chiave?: () => string | null | undefined) {
  const identita = useIdentity()
  const pubkey = computed(() => chiave?.() || identita.pubkey)
  const servizio = useMediaManager()
  const esistente = useEventoEsistente()

  /** The address in the card, when there is one. */
  const indirizzo = ref<string | null>(null)
  const stato = ref<StatoIndirizzo>('da-leggere')
  const esito = ref<EsitoIndirizzoStabile | null>(null)
  const errore = ref<string | null>(null)

  const pronto = computed(
    () => stato.value === 'verificato' && !!esito.value?.stessoFeed && !!esito.value.selfCorretto,
  )

  const urlTecnico = computed(() => {
    if (!pubkey.value || !servizio.configurato) return null
    try {
      return urlFeedPodcast(servizio.baseUrl, pubkey.value)
    } catch {
      return null
    }
  })

  /** Why an address cannot be a stable one before anything is downloaded, or `null`. */
  function scartaSubito(url: string): string | null {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return 'Scrivi l’indirizzo completo, con https:// davanti.'
    }
    const servizioHost = (() => {
      try {
        return new URL(normalizzaBaseUrl(servizio.baseUrl)).host
      } catch {
        return null
      }
    })()
    if (servizioHost && u.host === servizioHost) {
      return 'Questo è l’indirizzo tecnico del servizio, non uno tuo: se il servizio cambia, cambia anche lui.'
    }
    return null
  }

  async function verifica(url: string): Promise<EsitoIndirizzoStabile | null> {
    errore.value = null
    esito.value = null
    const tecnico = urlTecnico.value
    if (!tecnico) {
      errore.value = 'Serve un’identità e il servizio configurato: è lui a generare il feed.'
      stato.value = 'non-valido'
      return null
    }
    const subito = scartaSubito(url.trim())
    if (subito) {
      errore.value = subito
      stato.value = 'non-valido'
      return null
    }
    stato.value = 'in-verifica'
    try {
      let personale: Response
      try {
        // `manual`: a redirect must be seen, not followed.
        personale = await fetch(url.trim(), {
          redirect: 'manual',
          cache: 'no-store',
          headers: { accept: 'application/rss+xml' },
        })
      } catch {
        throw new Error(
          `Il browser non riesce a leggere ${url.trim()}. La causa più probabile è l’intermediario che non fa passare l’header CORS (Access-Control-Allow-Origin) del servizio: le app lo leggerebbero lo stesso, ma NMC non può verificarlo. Altrimenti l’indirizzo non risponde.`,
        )
      }
      if (
        personale.type === 'opaqueredirect' ||
        (personale.status >= 300 && personale.status < 400)
      ) {
        throw new Error(
          'L’indirizzo risponde con un redirect. Le app seguono il redirect e memorizzano l’indirizzo di arrivo, che è quello tecnico: configura l’intermediario perché restituisca il feed (200), non perché ci rimandi.',
        )
      }
      if (!personale.ok) throw new Error(`L’indirizzo risponde ${personale.status}.`)
      const risposta = await chiama(tecnico, {
        headers: { accept: 'application/rss+xml' },
        cache: 'no-store',
      })
      if (!risposta.ok) throw new Error(`Il servizio risponde ${risposta.status} per il feed.`)
      const confronto = confrontaIndirizzoStabile(
        riassumiFeedPodcast(await personale.text()),
        riassumiFeedPodcast(await risposta.text()),
        url.trim(),
      )
      esito.value = confronto
      stato.value = confronto.stessoFeed ? 'verificato' : 'non-valido'
      return confronto
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      stato.value = 'non-valido'
      return null
    }
  }

  /** Reads the address from the card on the relays, and checks it. */
  async function caricaDallaScheda(): Promise<void> {
    stato.value = 'da-leggere'
    esito.value = null
    errore.value = null
    indirizzo.value = null
    const trovato = await esistente.perCoordinata(10154, undefined, pubkey.value ?? undefined)
    try {
      indirizzo.value = trovato ? (podcastMetadataDefinition.parse(trovato).feedUrl ?? null) : null
    } catch {
      indirizzo.value = null
    }
    if (!indirizzo.value) {
      stato.value = 'assente'
      return
    }
    await verifica(indirizzo.value)
  }

  return { indirizzo, stato, esito, errore, pronto, urlTecnico, verifica, caricaDallaScheda }
}
