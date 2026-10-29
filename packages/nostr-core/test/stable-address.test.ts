import { describe, expect, it } from 'vitest'

import {
  confrontaIndirizzoStabile,
  indirizzoFeedAmmesso,
  recordCname,
  urlSottodominio,
  validaDominio,
  validaSottodominio,
} from '../src/feed/indirizzo.js'
import type { RiassuntoFeed } from '../src/feed/index.js'
import { autorizzaRichiesta, httpAuthDefinition } from '../src/kinds/definitions/http-auth.js'
import { getKindDefinition } from '../src/kinds/registry.js'
import { registerBuiltinKinds } from '../src/kinds/definitions/index.js'
import { newSecretKey, publicKeyFrom, signWithSecretKey } from '../src/identity/keys.js'
import { sha256Hex } from '../src/utils/hash.js'

/**
 * The stable address of the feed: the names a managed subdomain may take, the
 * records a CNAME needs, the check that an address serves this key's feed, and
 * the signed request (NIP-98) that will claim a name for a key.
 */

describe('managed subdomain names', () => {
  it('accepts a DNS label of 3 to 63 characters, lowercased', () => {
    expect(validaSottodominio('  MariaRossi ')).toEqual({ ok: true, nome: 'mariarossi' })
    expect(validaSottodominio('storie-di-bitcoin')).toEqual({ ok: true, nome: 'storie-di-bitcoin' })
    expect(validaSottodominio('a'.repeat(63)).ok).toBe(true)
  })

  it('refuses malformed and reserved names, saying why', () => {
    const motivo = (n: string) => {
      const e = validaSottodominio(n)
      return e.ok ? null : e.motivo
    }
    expect(motivo('ab')).toMatch(/almeno 3/)
    expect(motivo('a'.repeat(64))).toMatch(/al massimo 63/)
    expect(motivo('maria rossi')).toMatch(/niente spazi/)
    expect(motivo('maria.rossi')).toMatch(/niente spazi né punti/)
    expect(motivo('perché')).toMatch(/senza accenti/)
    expect(motivo('-maria')).toMatch(/trattino/)
    expect(motivo('maria-')).toMatch(/trattino/)
    expect(motivo('xn--maria')).toMatch(/xn--/)
    expect(motivo('api')).toMatch(/riservato/)
    expect(motivo('WWW')).toMatch(/riservato/)
  })

  it('builds the feed address on the configured suffix', () => {
    expect(urlSottodominio('mariarossi', 'duckdns.org')).toBe(
      'https://mariarossi.duckdns.org/feed.xml',
    )
    expect(urlSottodominio('mariarossi', '.nmc.xx.')).toBe('https://mariarossi.nmc.xx/feed.xml')
  })
})

describe('custom domains via CNAME', () => {
  it('normalises a domain and refuses what is not one', () => {
    expect(validaDominio('https://Feed.MariaRossi.it/qualcosa')).toEqual({
      ok: true,
      nome: 'feed.mariarossi.it',
    })
    expect(validaDominio('localhost').ok).toBe(false)
    expect(validaDominio('feed..it').ok).toBe(false)
    expect(validaDominio('feed_x.it').ok).toBe(false)
  })

  it('lists the CNAME and the TXT that proves the domain is the key’s', () => {
    const pubkey = 'ab'.repeat(32)
    const record = recordCname('feed.mariarossi.it', 'feeds.nmc.xx', pubkey)
    expect(record[0]).toEqual({ tipo: 'CNAME', nome: 'feed.mariarossi.it', valore: 'feeds.nmc.xx' })
    expect(record[1]?.tipo).toBe('TXT')
    expect(record[1]?.nome).toBe('_nmc.feed.mariarossi.it')
    expect(record[1]?.valore).toMatch(/^npub1/)
  })
})

describe('the feed tag', () => {
  it('takes https anywhere and plain http on the local machine only', () => {
    expect(indirizzoFeedAmmesso('https://feed.mariarossi.it/podcast.xml')).toBe(true)
    expect(indirizzoFeedAmmesso('http://localhost:7451/feed.xml')).toBe(true)
    expect(indirizzoFeedAmmesso('http://127.0.0.1/feed.xml')).toBe(true)
    expect(indirizzoFeedAmmesso('http://feed.mariarossi.it/podcast.xml')).toBe(false)
    expect(indirizzoFeedAmmesso('feed.mariarossi.it')).toBe(false)
  })
})

describe('the stable address serves this key’s feed', () => {
  const feed = (over: Partial<RiassuntoFeed> = {}): RiassuntoFeed => ({
    titolo: 'Show',
    descrizione: '',
    immagine: null,
    lingua: 'it',
    categoria: null,
    email: null,
    explicit: false,
    episodi: [
      { id: 'g1', titolo: 'Uno', data: null, audioUrl: null, byte: 0 },
      { id: 'g2', titolo: 'Due', data: null, audioUrl: null, byte: 0 },
    ],
    podcastGuid: '2977094a-c6b7-5d6c-9886-e3337ff33d87',
    nuovoFeedUrl: null,
    selfUrl: 'https://feed.mariarossi.it/podcast.xml',
    relays: [],
    problemi: [],
    ...over,
  })
  const URL_PERSONALE = 'https://feed.mariarossi.it/podcast.xml'

  it('is the same feed when identity and episodes match, and the self link names it', () => {
    const tecnico = feed({ selfUrl: 'https://servizio.example/v0/feed/npub.xml' })
    expect(confrontaIndirizzoStabile(feed(), tecnico, URL_PERSONALE)).toEqual({
      stessoFeed: true,
      selfCorretto: true,
      problemi: [],
    })
  })

  it('says when the address serves another podcast or other episodes', () => {
    const altro = confrontaIndirizzoStabile(feed({ podcastGuid: 'altro' }), feed(), URL_PERSONALE)
    expect(altro.stessoFeed).toBe(false)
    expect(altro.problemi[0]).toMatch(/un altro podcast/)
    const vecchio = confrontaIndirizzoStabile(
      feed({ episodi: [{ id: 'g1', titolo: 'Uno', data: null, audioUrl: null, byte: 0 }] }),
      feed(),
      URL_PERSONALE,
    )
    expect(vecchio.problemi[0]).toMatch(/1 mancanti, 0 in più/)
  })

  it('tells a wrong self link apart, naming the prompt that fixes it', () => {
    const esito = confrontaIndirizzoStabile(
      feed({ selfUrl: 'https://servizio.example/v0/feed/npub.xml' }),
      feed(),
      URL_PERSONALE,
    )
    expect(esito.stessoFeed).toBe(true)
    expect(esito.selfCorretto).toBe(false)
    expect(esito.problemi[0]).toMatch(/Prompt K/)
  })
})

describe('kind 27235, a signed HTTP request (NIP-98)', () => {
  const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

  it('is ephemeral and carries no client tag', () => {
    registerBuiltinKinds()
    expect(getKindDefinition(27235)?.class).toBe('ephemeral')
    const t = httpAuthDefinition.build(
      { url: 'https://api.nmc.xx/v0/feed/sottodomini', metodo: 'post' },
      CTX,
    )
    expect(t.kind).toBe(27235)
    expect(t.content).toBe('')
    expect(t.tags).toEqual([
      ['u', 'https://api.nmc.xx/v0/feed/sottodomini'],
      ['method', 'POST'],
    ])
  })

  it('requires an absolute URL and a known method', () => {
    expect(() => httpAuthDefinition.build({ url: '/v0/feed', metodo: 'GET' }, CTX)).toThrow(
      /URL completo/,
    )
    expect(() =>
      httpAuthDefinition.build({ url: 'ftp://x.example/a', metodo: 'GET' }, CTX),
    ).toThrow(/http/)
    expect(() =>
      httpAuthDefinition.build({ url: 'https://x.example/a', metodo: 'FETCH' }, CTX),
    ).toThrow(/Metodo/)
    expect(() =>
      httpAuthDefinition.build({ url: 'https://x.example/a', metodo: 'POST', payload: 'xyz' }, CTX),
    ).toThrow(/SHA-256/)
  })

  it('signs a request with the body’s hash, in a base64 Authorization header', async () => {
    const sk = newSecretKey()
    const pubkey = publicKeyFrom(sk)
    const corpo = JSON.stringify({ nome: 'mariarossi' })
    const header = await autorizzaRichiesta(async (t) => signWithSecretKey(t, sk), pubkey, {
      url: 'https://api.nmc.xx/v0/feed/sottodomini',
      metodo: 'POST',
      corpo,
    })
    expect(header).toMatch(/^Nostr [A-Za-z0-9+/]+=*$/)
    const evento = JSON.parse(atob(header.slice(6)))
    expect(evento.pubkey).toBe(pubkey)
    expect(httpAuthDefinition.parse(evento)).toEqual({
      url: 'https://api.nmc.xx/v0/feed/sottodomini',
      metodo: 'POST',
      payload: await sha256Hex(corpo),
    })
  })
})
