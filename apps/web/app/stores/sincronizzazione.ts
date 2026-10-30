import {
  blossomServersDefinition,
  campiDaListe,
  destinazioniLista,
  fondiTag,
  listeDaConfig,
  loadTimeline,
  mergeRelayLists,
  relayListDefinition,
  soloPubblici,
  stessiRelay,
  stessiServer,
  type NostrEvent,
  type VoceRelay,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

import { useConfigurazione } from '~/stores/configurazione'

/**
 * The relays and the Blossom servers, kept in step with the key.
 *
 * The `.env` values are first-run defaults; the user's choice lives on the
 * relays, as the key's kind 10002 (NIP-65) and 10063 (BUD-03). This store
 * reads both whenever an identity becomes active and, when they say something
 * different from this device, takes them — so that logging in on a new
 * browser starts from the user's relays, not from someone else's defaults.
 *
 * Two rules keep that from overwriting anything:
 *
 *  - **reading never publishes.** A 10002 is read by every Nostr client the
 *    user has: publishing one rewrites where all of them read and write.
 *    That happens only when the user asks, from the settings, after seeing
 *    the list;
 *  - **a newer choice on this device is not overwritten.** When the user
 *    changed the relays here, with this key, after the published list was
 *    signed, the published list is not taken: the page says the two differ
 *    and lets them choose. The time of each change is kept per key, so a
 *    change made with one identity does not hold for another.
 */

export type QualeLista = 'relay' | 'blossom'
export type StatoLista = 'da-leggere' | 'in-lettura' | 'assente' | 'allineata' | 'diversa'

const CHIAVE_STORAGE = 'nmc.liste-modificate'
type Modifiche = Record<string, Partial<Record<QualeLista, number>>>

function leggiModifiche(): Modifiche {
  if (!import.meta.client) return {}
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_STORAGE) ?? '{}') as Modifiche
  } catch {
    return {}
  }
}

function scriviModifiche(m: Modifiche): void {
  try {
    localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(m))
  } catch {
    // Storage full or denied: the comparison falls back on the published list.
  }
}

const adesso = (): number => Math.floor(Date.now() / 1000)

const dataLeggibile = (secondi: number): string =>
  new Date(secondi * 1000).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' })

export const useSincronizzazione = defineStore('sincronizzazione', () => {
  const identita = useIdentity()
  const configurazione = useConfigurazione()
  const pool = useRelayPool()
  const invio = usePublish()

  /** The key the lists below belong to. */
  const perChiave = ref<string | null>(null)
  const inLettura = ref(false)
  let lettura = 0

  const eventi = reactive<Record<QualeLista, NostrEvent | null>>({ relay: null, blossom: null })
  const notizia = reactive<Record<QualeLista, string | null>>({ relay: null, blossom: null })
  const errore = reactive<Record<QualeLista, string | null>>({ relay: null, blossom: null })
  const inPubblicazione = ref<QualeLista | null>(null)

  /** What was published, as lists. */
  const pubblicate = computed(() => ({
    relay: eventi.relay ? relayListDefinition.parse(eventi.relay).relays : null,
    blossom: eventi.blossom ? blossomServersDefinition.parse(eventi.blossom).server : null,
  }))

  /** What this device would publish, and what stays on it. */
  const locali = computed(() =>
    configurazione.config ? listeDaConfig(configurazione.config) : null,
  )

  function uguale(quale: QualeLista): boolean {
    const qui = locali.value?.liste
    const r = pubblicate.value
    if (!qui) return false
    if (quale === 'relay') {
      return (
        !!r.relay && stessiRelay(qui.relay, soloPubblici({ relay: r.relay, blossom: [] }).relay)
      )
    }
    return (
      !!r.blossom &&
      stessiServer(qui.blossom, soloPubblici({ relay: [], blossom: r.blossom }).blossom)
    )
  }

  function statoDi(quale: QualeLista): StatoLista {
    if (!identita.pubkey) return 'da-leggere'
    if (inLettura.value) return 'in-lettura'
    if (perChiave.value !== identita.pubkey) return 'da-leggere'
    if (!eventi[quale]) return 'assente'
    return uguale(quale) ? 'allineata' : 'diversa'
  }

  const stato = computed<Record<QualeLista, StatoLista>>(() => ({
    relay: statoDi('relay'),
    blossom: statoDi('blossom'),
  }))

  /** When each list was signed, readable. */
  const firmataIl = computed<Record<QualeLista, string | null>>(() => ({
    relay: eventi.relay ? dataLeggibile(eventi.relay.created_at) : null,
    blossom: eventi.blossom ? dataLeggibile(eventi.blossom.created_at) : null,
  }))

  function azzera(): void {
    for (const q of ['relay', 'blossom'] as const) {
      eventi[q] = null
      notizia[q] = null
      errore[q] = null
    }
    perChiave.value = null
  }

  /** Reads the active key's lists, and takes them when nothing newer is here. */
  async function leggi(): Promise<void> {
    const pubkey = identita.pubkey
    const cfg = configurazione.config
    if (!pool || !pubkey || !cfg) return
    const questa = ++lettura
    inLettura.value = true
    try {
      // The indexers first: it is where a key's lists are meant to be found.
      const trovati = await loadTimeline(
        pool,
        mergeRelayLists(cfg.indexerRelays, cfg.readRelays, cfg.writeRelays),
        { kinds: [10002, 10063], authors: [pubkey] },
        { timeoutMs: 8000 },
      )
      // Another identity became active meanwhile: its own reading is under way.
      if (questa !== lettura || identita.pubkey !== pubkey) return
      eventi.relay = trovati.find((e) => e.kind === 10002 && e.pubkey === pubkey) ?? null
      eventi.blossom = trovati.find((e) => e.kind === 10063 && e.pubkey === pubkey) ?? null
      perChiave.value = pubkey
      for (const q of ['relay', 'blossom'] as const) prendiSeNonCeDiMeglio(q, pubkey)
    } finally {
      if (questa === lettura) inLettura.value = false
    }
  }

  function prendiSeNonCeDiMeglio(quale: QualeLista, pubkey: string): void {
    const evento = eventi[quale]
    if (!evento || uguale(quale)) return
    const cambiataQui = leggiModifiche()[pubkey]?.[quale] ?? 0
    if (cambiataQui > evento.created_at) return
    if (prendi(quale)) {
      notizia[quale] =
        `${quale === 'relay' ? 'Relay presi' : 'Server Blossom presi'} dalla lista che hai ` +
        `pubblicato il ${dataLeggibile(evento.created_at)}.`
    }
  }

  /** Replaces this device's endpoints with the published list. */
  function prendi(quale: QualeLista): boolean {
    const cfg = configurazione.config
    const r = pubblicate.value
    if (!cfg) return false
    const campi = campiDaListe(quale === 'relay' ? { relay: r.relay } : { blossom: r.blossom }, cfg)
    if (Object.keys(campi).length === 0) {
      errore[quale] =
        'La lista pubblicata non contiene indirizzi utilizzabili: resta quella di qui.'
      return false
    }
    const esito = configurazione.applica(campi)
    if (!esito.ok) {
      errore[quale] = `La lista pubblicata non si può usare: ${esito.errore}`
      return false
    }
    errore[quale] = null
    notizia[quale] = null
    // Taken, not changed: what is here is the published list again.
    dimenticaModifica(quale)
    return true
  }

  /** Called by the settings when the user changes the endpoints by hand. */
  function segnaModifica(quali: readonly QualeLista[]): void {
    const pubkey = identita.pubkey
    for (const q of quali) notizia[q] = null
    if (!pubkey || quali.length === 0) return
    const m = leggiModifiche()
    m[pubkey] = { ...m[pubkey], ...Object.fromEntries(quali.map((q) => [q, adesso()])) }
    scriviModifiche(m)
  }

  function dimenticaModifica(quale: QualeLista): void {
    const pubkey = identita.pubkey
    if (!pubkey) return
    const m = leggiModifiche()
    if (!m[pubkey]?.[quale]) return
    delete m[pubkey][quale]
    scriviModifiche(m)
  }

  /** Publishes this device's list on the active key. */
  async function pubblica(quale: QualeLista): Promise<boolean> {
    const pubkey = identita.pubkey
    const cfg = configurazione.config
    if (!pubkey || !cfg) return false
    if (!identita.puoFirmare) {
      errore[quale] = identita.motivoNonFirmabile ?? 'Serve una chiave che possa firmare.'
      return false
    }
    inPubblicazione.value = quale
    errore[quale] = null
    notizia[quale] = null
    invio.azzera()
    try {
      const { liste } = listeDaConfig(cfg)
      const precedente = eventi[quale]
      // A replaceable event with the same created_at as the version it
      // replaces may lose against it: one second later is enough.
      const ctx = { pubkey, now: Math.max(adesso(), (precedente?.created_at ?? 0) + 1) }
      const costruito =
        quale === 'relay'
          ? relayListDefinition.build({ relays: liste.relay }, ctx)
          : blossomServersDefinition.build({ server: liste.blossom }, ctx)
      // Whatever another client added to the previous version stays.
      const propri = quale === 'relay' ? 'r' : 'server'
      const altri = (precedente?.tags ?? []).filter((t) => t[0] !== propri && t[0] !== 'client')
      const firmato = await identita.firma({ ...costruito, tags: fondiTag(costruito.tags, altri) })
      const vecchia: readonly VoceRelay[] = quale === 'relay' ? (pubblicate.value.relay ?? []) : []
      const ok = await invio.pubblica(firmato, destinazioniLista(cfg, vecchia), {
        strategia: 'tutti',
      })
      if (!ok) {
        errore[quale] = invio.errore.value ?? 'Nessun relay ha accettato la lista: vedi qui sotto.'
        return false
      }
      eventi[quale] = firmato
      dimenticaModifica(quale)
      return true
    } catch (e) {
      errore[quale] = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inPubblicazione.value = null
    }
  }

  // Logging in, switching identity, logging out: the lists follow the key.
  watch(
    () => identita.pubkey,
    (pubkey) => {
      if (pubkey !== perChiave.value) azzera()
      if (pubkey) void leggi()
    },
    { immediate: true },
  )

  return {
    stato,
    pubblicate,
    locali,
    firmataIl,
    notizia,
    errore,
    inPubblicazione,
    esitoPubblicazione: invio.esito,
    leggi,
    prendi,
    pubblica,
    segnaModifica,
  }
})
