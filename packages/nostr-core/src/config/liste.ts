import type { RelayListParsed } from '../kinds/definitions/relay-list.js'
import type { ClientConfig, RawEnv } from './defaults.js'

/**
 * The user's endpoints as public lists, and back.
 *
 * The read and write relays become the key's kind 10002 (NIP-65), the
 * Blossom servers its kind 10063 (BUD-03). Every Nostr client reads them, and
 * NMC reads them at login so that a new device starts from the user's relays
 * instead of the `.env` ones. The indexers and the drafts relay stay out: the
 * first are this client's business, the second is private by design.
 *
 * What only this device can reach — a relay on localhost, a server on the
 * home network — stays out of the lists too. Published, it would tell the rest
 * of the network to look where it cannot, and it would say something about the
 * user's network that is nobody's business. It stays in this device's
 * configuration, untouched.
 */

export type VoceRelay = RelayListParsed['relays'][number]

export interface ListePubbliche {
  relay: VoceRelay[]
  blossom: string[]
}

/** The configuration fields a published list fills in. */
export type CampiListe = Pick<
  RawEnv,
  | 'NUXT_PUBLIC_DEFAULT_READ_RELAYS'
  | 'NUXT_PUBLIC_DEFAULT_WRITE_RELAYS'
  | 'NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS'
>

type Endpoint = Pick<ClientConfig, 'readRelays' | 'writeRelays' | 'blossomServers'>

const normalizza = (url: string): string => url.trim().replace(/\/+$/, '')

/**
 * Whether an address is reachable by anybody, not only from this machine or
 * this network: an encrypted scheme, and a host that is not local.
 */
export function indirizzoPubblico(url: string): boolean {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return false
  }
  if (u.protocol !== 'wss:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /\.(localhost|local|lan|home|internal)$/.test(host)) return false
  if (/^(0|10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return false
  }
  if (
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  ) {
    return false
  }
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return false
  // A bare name (`relay`) resolves on a local network only.
  return host.includes('.') || host.includes(':')
}

/**
 * What the configuration in force would publish, and what stays on this
 * device.
 *
 * The write relays come first, in their order: it is the order of the
 * attempts, and adopting the list back on another device keeps it.
 */
export function listeDaConfig(config: Endpoint): { liste: ListePubbliche; esclusi: string[] } {
  const esclusi: string[] = []
  const escludi = (url: string): void => {
    if (!esclusi.includes(url)) esclusi.push(url)
  }

  const perUrl = new Map<string, VoceRelay>()
  const voci = [
    ...config.writeRelays.map((url) => ({ url, lettura: false, scrittura: true })),
    ...config.readRelays.map((url) => ({ url, lettura: true, scrittura: false })),
  ]
  for (const v of voci) {
    const url = normalizza(v.url)
    if (!indirizzoPubblico(url)) {
      escludi(url)
      continue
    }
    const prima = perUrl.get(url)
    perUrl.set(url, {
      url,
      lettura: v.lettura || !!prima?.lettura,
      scrittura: v.scrittura || !!prima?.scrittura,
    })
  }

  const blossom: string[] = []
  for (const grezzo of config.blossomServers) {
    const url = normalizza(grezzo)
    if (!indirizzoPubblico(url)) escludi(url)
    else if (!blossom.includes(url)) blossom.push(url)
  }

  return { liste: { relay: [...perUrl.values()], blossom }, esclusi }
}

/**
 * Whether two relay lists say the same thing. The order does not count: NIP-65
 * gives it no meaning, and a list published by another client in another order
 * is the same list.
 */
export function stessiRelay(a: readonly VoceRelay[], b: readonly VoceRelay[]): boolean {
  const chiave = (v: VoceRelay): string => `${normalizza(v.url)} ${v.lettura} ${v.scrittura}`
  const sa = new Set(a.map(chiave))
  const sb = new Set(b.map(chiave))
  return sa.size === sb.size && [...sa].every((k) => sb.has(k))
}

/** Whether two server lists are the same. Here the order counts: the first is the primary. */
export function stessiServer(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((u, i) => normalizza(u) === normalizza(b[i] ?? ''))
}

/** Only the entries a list can carry, for comparing what was published with what is here. */
export function soloPubblici(lista: ListePubbliche): ListePubbliche {
  return {
    relay: lista.relay.filter((v) => indirizzoPubblico(v.url)),
    blossom: lista.blossom.filter(indirizzoPubblico),
  }
}

/**
 * The configuration fields a published list replaces.
 *
 * The device's own addresses are kept after the published ones: they were
 * never in the list, and adopting it must not take them away. A category the
 * list leaves empty — a 10002 with read relays only — is not touched: the
 * client cannot do without write relays.
 */
export function campiDaListe(
  pubblicate: { relay?: readonly VoceRelay[] | null; blossom?: readonly string[] | null },
  attuale: Endpoint,
): CampiListe {
  const locali = (l: readonly string[]): string[] =>
    l.map(normalizza).filter((u) => !indirizzoPubblico(u))
  const unisci = (pubblici: string[], propri: string[]): string =>
    [...new Set([...pubblici, ...propri])].join(',')

  const campi: CampiListe = {}
  if (pubblicate.relay) {
    const lettura = pubblicate.relay.filter((v) => v.lettura).map((v) => normalizza(v.url))
    const scrittura = pubblicate.relay.filter((v) => v.scrittura).map((v) => normalizza(v.url))
    if (lettura.length) {
      campi.NUXT_PUBLIC_DEFAULT_READ_RELAYS = unisci(lettura, locali(attuale.readRelays))
    }
    if (scrittura.length) {
      campi.NUXT_PUBLIC_DEFAULT_WRITE_RELAYS = unisci(scrittura, locali(attuale.writeRelays))
    }
  }
  if (pubblicate.blossom?.length) {
    campi.NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS = unisci(
      pubblicate.blossom.map(normalizza),
      locali(attuale.blossomServers),
    )
  }
  return campi
}

/**
 * Where a new list goes: the write relays, the indexers — it is there that
 * other clients and the feed service look a key's relays up — and, for the
 * relay list, the write relays of the previous version too. Whoever still
 * reads from those must find out that they changed.
 */
export function destinazioniLista(
  config: Pick<ClientConfig, 'writeRelays' | 'indexerRelays'>,
  precedente: readonly VoceRelay[] = [],
): string[] {
  const tutte = [
    ...config.writeRelays,
    ...config.indexerRelays,
    ...precedente.filter((v) => v.scrittura).map((v) => v.url),
  ].map(normalizza)
  return [...new Set(tutte)]
}
