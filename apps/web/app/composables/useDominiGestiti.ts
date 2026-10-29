import {
  autorizzaRichiesta,
  chiama,
  normalizzaBaseUrl,
  recordCname,
  urlSottodominio,
  type RecordDns,
} from '@nmc/nostr-core'

import { useMediaManager } from '~/stores/mediamanager'

/**
 * The feed's stable address on a domain NMC manages: a CNAME to the service,
 * or a subdomain the operator sets up.
 *
 * Both need the NMC domain, which does not exist yet. Until then they are
 * «coming soon» and run on a **simulation**: it answers like the service would,
 * so the whole flow can be tried, but it calls nothing, signs nothing and
 * saves nothing — the subdomain it hands back is always
 * `<name>.<suffix>`, and the page says it is a trial.
 *
 * The real implementation talks to the endpoints of Prompts L and M with a
 * NIP-98 signed request. It is used only when the operator has turned on
 * `NUXT_PUBLIC_FEED_DOMINI_GESTITI` **and** the service declares the feature in
 * its capabilities: a service claiming to be ready by mistake is not enough.
 */

export interface DominiGestiti {
  modo: 'simulata' | 'servizio'
  disponibile(nome: string): Promise<{ libero: boolean; motivo?: string }>
  registra(nome: string): Promise<{ url: string }>
  dichiaraCname(dominio: string): Promise<{ record: RecordDns[]; attivo: boolean; url?: string }>
}

interface Capacita {
  /** The domain the subdomains live under, or `null` when the service offers none. */
  sottodomini: string | null
  cname: boolean
}

export function useDominiGestiti() {
  const pubblica = useRuntimeConfig().public
  const servizio = useMediaManager()
  const identita = useIdentity()

  const interruttore = [true, 'true'].includes(pubblica.feedDominiGestiti as boolean | string)
  const suffisso = String(pubblica.feedSubdomainSuffix || 'duckdns.org')

  const capacita = ref<Capacita | null>(null)
  const radice = computed(() => normalizzaBaseUrl(servizio.baseUrl))

  /** Asks the service what it offers. With the switch off it does not even ask. */
  async function leggiCapacita(): Promise<void> {
    if (!interruttore || !radice.value) return
    try {
      const r = await chiama(`${radice.value}/v0/feed/domini/capacita`, {}, { timeoutMs: 10_000 })
      if (!r.ok) return
      const dati = (await r.json()) as Partial<Capacita>
      capacita.value = {
        sottodomini:
          typeof dati.sottodomini === 'string' && dati.sottodomini ? dati.sottodomini : null,
        cname: dati.cname === true,
      }
    } catch {
      capacita.value = null
    }
  }

  const sottodominiAttivi = computed(() => interruttore && !!capacita.value?.sottodomini)
  const cnameAttivo = computed(() => interruttore && !!capacita.value?.cname)
  const suffissoEffettivo = computed(() => capacita.value?.sottodomini ?? suffisso)
  /** Where every creator's CNAME points: it must stay for ever. */
  const destinazioneCname = computed(() => `feeds.${suffissoEffettivo.value}`)

  const simulata: DominiGestiti = {
    modo: 'simulata',
    disponibile: async () => ({ libero: true }),
    registra: async (nome) => ({ url: urlSottodominio(nome, suffisso) }),
    dichiaraCname: async (dominio) => ({
      record: recordCname(dominio, destinazioneCname.value, identita.pubkey ?? '00'.repeat(32)),
      attivo: false,
    }),
  }

  /** A signed request to the service: the podcast's key proves the name is its own. */
  async function firmata(percorso: string, corpo: Record<string, string>): Promise<Response> {
    if (!identita.puoFirmare || !identita.pubkey) {
      throw new Error(identita.motivoNonFirmabile ?? 'Serve la chiave del podcast, sbloccata.')
    }
    const url = `${radice.value}${percorso}`
    const testo = JSON.stringify(corpo)
    const authorization = await autorizzaRichiesta((t) => identita.firma(t), identita.pubkey, {
      url,
      metodo: 'POST',
      corpo: testo,
    })
    return chiama(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: testo,
    })
  }

  async function messaggio(r: Response, ripiego: string): Promise<string> {
    try {
      const dati = (await r.json()) as { detail?: string; motivo?: string }
      return dati.detail ?? dati.motivo ?? ripiego
    } catch {
      return ripiego
    }
  }

  const reale: DominiGestiti = {
    modo: 'servizio',
    async disponibile(nome) {
      const r = await chiama(`${radice.value}/v0/feed/sottodomini/${encodeURIComponent(nome)}`, {})
      if (!r.ok)
        return { libero: false, motivo: await messaggio(r, `Il servizio risponde ${r.status}.`) }
      const dati = (await r.json()) as { libero?: boolean; motivo?: string }
      return { libero: dati.libero === true, ...(dati.motivo ? { motivo: dati.motivo } : {}) }
    },
    async registra(nome) {
      const r = await firmata('/v0/feed/sottodomini', { nome })
      if (r.status === 409) throw new Error(`«${nome}» è già stato preso: scegline un altro.`)
      if (!r.ok) throw new Error(await messaggio(r, `Il servizio risponde ${r.status}.`))
      const dati = (await r.json()) as { url?: string }
      if (!dati.url) throw new Error('Il servizio non ha restituito l’indirizzo del feed.')
      return { url: dati.url }
    },
    async dichiaraCname(dominio) {
      const r = await firmata('/v0/feed/domini', { dominio })
      if (r.status === 409) throw new Error(`«${dominio}» è già dichiarato da un’altra chiave.`)
      if (!r.ok) throw new Error(await messaggio(r, `Il servizio risponde ${r.status}.`))
      const dati = (await r.json()) as { attivo?: boolean; url?: string }
      return {
        record: recordCname(dominio, destinazioneCname.value, identita.pubkey ?? ''),
        attivo: dati.attivo === true,
        ...(dati.url ? { url: dati.url } : {}),
      }
    },
  }

  const sottodomini = computed(() => (sottodominiAttivi.value ? reale : simulata))
  const cname = computed(() => (cnameAttivo.value ? reale : simulata))

  return {
    interruttore,
    capacita,
    leggiCapacita,
    sottodominiAttivi,
    cnameAttivo,
    suffisso: suffissoEffettivo,
    destinazioneCname,
    sottodomini,
    cname,
  }
}
