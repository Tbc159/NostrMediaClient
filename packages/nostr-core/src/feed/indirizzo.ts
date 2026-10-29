import { toNpub } from '../identity/keys.js'
import type { RiassuntoFeed } from './index.js'

/**
 * The feed's stable address: the name the podcast is known by, on any host.
 *
 * Once an app has subscribed, the feed's URL *is* the podcast: changing it
 * means a move, with a redirect and `itunes:new-feed-url` kept for weeks. So
 * the address that gets submitted must be one the creator controls, not the
 * service's technical one. Three ways to get there:
 *
 *   1. their own domain, through an intermediary of theirs (a reverse proxy)
 *      that asks the service for the feed and answers with a 200;
 *   2. their own domain pointed at the service with a CNAME — coming with the
 *      NMC domain;
 *   3. a subdomain the NMC operator manages for them — coming with the NMC
 *      domain.
 *
 * Never an HTTP redirect in front of the service: the apps follow a 301 and
 * remember where it lands, which is the technical address.
 */

/** The labels the operator keeps for itself, never handed out as a podcast's subdomain. */
export const SOTTODOMINI_RISERVATI: readonly string[] = [
  'admin',
  'api',
  'app',
  'blossom',
  'cdn',
  'dev',
  'docs',
  'feed',
  'feeds',
  'ftp',
  'help',
  'imap',
  'mail',
  'media',
  'nmc',
  'ns1',
  'ns2',
  'pop',
  'relay',
  'root',
  'smtp',
  'staging',
  'static',
  'status',
  'support',
  'test',
  'www',
]

export type EsitoNome = { ok: true; nome: string } | { ok: false; motivo: string }

/**
 * Whether a name can become a podcast's subdomain: a DNS label of 3 to 63
 * lowercase letters, digits and hyphens, not at the ends, and not reserved.
 */
export function validaSottodominio(grezzo: string): EsitoNome {
  const nome = grezzo.trim().toLowerCase()
  if (nome.length < 3) return { ok: false, motivo: 'Il nome deve avere almeno 3 caratteri.' }
  if (nome.length > 63) return { ok: false, motivo: 'Il nome può avere al massimo 63 caratteri.' }
  if (!/^[a-z0-9-]+$/.test(nome)) {
    return {
      ok: false,
      motivo: 'Solo lettere minuscole senza accenti, cifre e trattini: niente spazi né punti.',
    }
  }
  if (nome.startsWith('-') || nome.endsWith('-')) {
    return { ok: false, motivo: 'Il nome non può iniziare né finire con un trattino.' }
  }
  if (nome.startsWith('xn--')) {
    return { ok: false, motivo: 'I nomi che iniziano con «xn--» sono riservati al DNS.' }
  }
  if (SOTTODOMINI_RISERVATI.includes(nome)) {
    return { ok: false, motivo: `«${nome}» è riservato al servizio: scegline un altro.` }
  }
  return { ok: true, nome }
}

/** The feed's address on a managed subdomain. */
export function urlSottodominio(nome: string, suffisso: string): string {
  return `https://${nome}.${suffisso.replace(/^\.+|\.+$/g, '')}/feed.xml`
}

/** Whether a host name is a domain one can point a CNAME from: at least two labels, no scheme. */
export function validaDominio(grezzo: string): EsitoNome {
  const dominio = grezzo
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
  const etichette = dominio.split('.')
  if (etichette.length < 2) {
    return { ok: false, motivo: 'Scrivi un dominio completo, per esempio «feed.mariarossi.it».' }
  }
  for (const e of etichette) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(e)) {
      return { ok: false, motivo: `«${dominio}» non è un nome di dominio valido.` }
    }
  }
  return { ok: true, nome: dominio }
}

export interface RecordDns {
  tipo: 'CNAME' | 'TXT'
  nome: string
  valore: string
}

/**
 * The two records a domain needs to point at the service.
 *
 * The CNAME sends the traffic; the TXT proves the domain belongs to the key —
 * without it, two keys could claim the same domain, and the service could not
 * tell which one owns it.
 */
export function recordCname(dominio: string, destinazione: string, pubkey: string): RecordDns[] {
  return [
    { tipo: 'CNAME', nome: dominio, valore: destinazione },
    { tipo: 'TXT', nome: `_nmc.${dominio}`, valore: toNpub(pubkey) },
  ]
}

/** An address for the `feed` tag: https, or http on the local machine for development. */
export function indirizzoFeedAmmesso(valore: string): boolean {
  try {
    const u = new URL(valore)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

const normalizzaUrl = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase()

export interface EsitoIndirizzoStabile {
  /** Same show, same episodes: the address serves this key's feed. */
  stessoFeed: boolean
  /** The feed declares the stable address as its own (`atom:link rel="self"`). */
  selfCorretto: boolean
  problemi: string[]
}

/**
 * Whether the stable address serves the same feed as the technical one.
 *
 * Same `podcast:guid` and same episodes, by GUID: that is what makes it the
 * same podcast for an app. The self link is checked apart, because it can only
 * be right once the card carries the address and the service reads it.
 */
export function confrontaIndirizzoStabile(
  personale: RiassuntoFeed,
  tecnico: RiassuntoFeed,
  urlPersonale: string,
): EsitoIndirizzoStabile {
  const problemi: string[] = []
  if (personale.podcastGuid !== tecnico.podcastGuid) {
    problemi.push(
      `L’indirizzo serve un altro podcast: identità ${personale.podcastGuid ?? 'assente'} invece di ${tecnico.podcastGuid ?? 'assente'}.`,
    )
  }
  const guid = (r: RiassuntoFeed) => new Set(r.episodi.map((e) => e.id).filter(Boolean))
  const dalTecnico = guid(tecnico)
  const dalPersonale = guid(personale)
  const mancanti = [...dalTecnico].filter((g) => !dalPersonale.has(g)).length
  const estranei = [...dalPersonale].filter((g) => !dalTecnico.has(g)).length
  if (mancanti || estranei) {
    problemi.push(
      `Gli episodi non coincidono (${mancanti} mancanti, ${estranei} in più): l’indirizzo non inoltra il feed di questa chiave, o ne tiene una copia vecchia.`,
    )
  }
  const stessoFeed = problemi.length === 0
  const selfCorretto =
    !!personale.selfUrl && normalizzaUrl(personale.selfUrl) === normalizzaUrl(urlPersonale)
  if (stessoFeed && !selfCorretto) {
    problemi.push(
      `Il feed dichiara di stare a ${personale.selfUrl ?? '(nessun indirizzo)'}, non a ${urlPersonale}: il servizio deve leggere l’indirizzo stabile dalla scheda (Prompt K). Finché non lo fa, non sottoporlo e non fare redirect.`,
    )
  }
  return { stessoFeed, selfCorretto, problemi }
}
