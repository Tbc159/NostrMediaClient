import { decode } from 'nostr-tools/nip19'
import { describe, expect, it } from 'vitest'

import {
  CLIENT_PREDEFINITO,
  clientEsterniPredefiniti,
  clientPerEvento,
  componiLinkEsterno,
  linkEventoEsterno,
  nip19PointerFor,
  risolviClient,
  tipoPuntatorePer,
  validaTemplate,
  type ClientEsterno,
} from '../src/clients/index.js'
import type { NostrEvent } from '../src/kinds/types.js'

const PUBKEY = 'ab'.repeat(32)
const RELAYS = ['wss://uno.example', 'wss://due.example']

function evento(p: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: PUBKEY,
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

describe('the identifier for the external clients', () => {
  it('uses naddr for the editable events, not nevent', () => {
    // An nevent points at *that* version: as soon as the event is edited the
    // link would show the superseded version, or nothing at all.
    const pointer = nip19PointerFor(evento({ kind: 30023, tags: [['d', 'articolo-x']] }), RELAYS)
    const decodificato = decode(pointer)

    expect(decodificato.type).toBe('naddr')
    expect(decodificato.data).toMatchObject({
      kind: 30023,
      identifier: 'articolo-x',
      pubkey: PUBKEY,
    })
  })

  it('uses nprofile for kind 0, which in clients is a profile page', () => {
    const decodificato = decode(nip19PointerFor(evento({ kind: 0 }), RELAYS))
    expect(decodificato.type).toBe('nprofile')
    expect(decodificato.data).toMatchObject({ pubkey: PUBKEY })
  })

  it('uses nevent for the regular events', () => {
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), RELAYS))
    expect(decodificato.type).toBe('nevent')
    expect(decodificato.data).toMatchObject({ id: 'ff'.repeat(32), kind: 1 })
  })

  it('carries the relays as hints', () => {
    // Without them the external client looks for the event on its own relays
    // alone and often does not find it: it is the difference between a link
    // that works and one that opens an empty page.
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), RELAYS))
    expect((decodificato.data as { relays?: string[] }).relays).toEqual(RELAYS)
  })

  it('puts no more than three of them, and no duplicates', () => {
    const molti = ['wss://a', 'wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e']
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), molti))
    expect((decodificato.data as { relays?: string[] }).relays).toEqual([
      'wss://a',
      'wss://b',
      'wss://c',
    ])
  })

  it('works without relays too', () => {
    expect(() => nip19PointerFor(evento({ kind: 1 }))).not.toThrow()
  })
})

describe('composing the link', () => {
  it('replaces the placeholder', () => {
    expect(componiLinkEsterno('https://esempio.tld/{pointer}', 'nevent1abc')).toBe(
      'https://esempio.tld/nevent1abc',
    )
  })

  it('refuses a template without a placeholder', () => {
    // Without one every event would open the same page: a silent failure.
    expect(() => componiLinkEsterno('https://esempio.tld/', 'nevent1abc')).toThrow(/\{pointer\}/)
  })

  it('keeps a template passed as a string, for the preview in the settings', () => {
    const link = linkEventoEsterno('https://esempio.tld/x/{pointer}', evento({ kind: 1 }), RELAYS)
    expect(link).toMatch(/^https:\/\/esempio\.tld\/x\/nevent1/)
  })

  it("composes NIP-21's nostr: scheme", () => {
    const link = linkEventoEsterno('nostr:{pointer}', evento({ kind: 1 }))
    expect(link).toMatch(/^nostr:nevent1/)
  })
})

describe("the paths that depend on the pointer's form", () => {
  const preset = (id: string): ClientEsterno =>
    clientEsterniPredefiniti.find((c) => c.id === id) as ClientEsterno

  it('chooses the right form for every class of event', () => {
    expect(tipoPuntatorePer(evento({ kind: 0 }))).toBe('nprofile')
    expect(tipoPuntatorePer(evento({ kind: 30023, tags: [['d', 'x']] }))).toBe('naddr')
    expect(tipoPuntatorePer(evento({ kind: 1 }))).toBe('nevent')
    expect(tipoPuntatorePer(evento({ kind: 54 }))).toBe('nevent')
  })

  it('has noStrudel use /l/, which sorts the three forms out by itself', () => {
    // The /n/ path is a *note's* view: with an naddr it answers «Unknown type
    // naddr», and with an nprofile «Unknown type nprofile». Verified by loading
    // both paths in a browser.
    for (const e of [
      evento({ kind: 1 }),
      evento({ kind: 0 }),
      evento({ kind: 30023, tags: [['d', 'x']] }),
    ]) {
      expect(linkEventoEsterno(preset('nostrudel'), e, RELAYS)).toMatch(
        /^https:\/\/nostrudel\.ninja\/l\//,
      )
    }
  })

  it('has Primal send the profiles to /p/ and everything else to /e/', () => {
    // /e/ with an nprofile returns «404 Page not found».
    expect(linkEventoEsterno(preset('primal'), evento({ kind: 0 }), RELAYS)).toMatch(
      /^https:\/\/primal\.net\/p\/nprofile1/,
    )
    expect(linkEventoEsterno(preset('primal'), evento({ kind: 1 }), RELAYS)).toMatch(
      /^https:\/\/primal\.net\/e\/nevent1/,
    )
    expect(
      linkEventoEsterno(preset('primal'), evento({ kind: 30023, tags: [['d', 'x']] }), RELAYS),
    ).toMatch(/^https:\/\/primal\.net\/e\/naddr1/)
  })

  it('has a client with no separate forms use the same template for everything', () => {
    const generico: ClientEsterno = {
      id: 'generico',
      nome: 'Generico',
      template: 'https://esempio.tld/{pointer}',
      piattaforme: ['desktop'],
    }
    expect(linkEventoEsterno(generico, evento({ kind: 0 }), RELAYS)).toMatch(/\/nprofile1/)
    expect(linkEventoEsterno(generico, evento({ kind: 1 }), RELAYS)).toMatch(/\/nevent1/)
  })
})

describe('the kinds the chosen client cannot display', () => {
  const preset = (id: string): ClientEsterno =>
    clientEsterniPredefiniti.find((c) => c.id === id) as ClientEsterno

  it('leaves the chosen client in place when it can display the kind', () => {
    const r = clientPerEvento(preset('nostrudel'), evento({ kind: 1 }))
    expect(r.client.id).toBe('nostrudel')
    expect(r.sostituito).toBeNull()
  })

  it('falls back on Coracle for the calendar events', () => {
    // noStrudel opens them under «Unknown event kind», with no date and no
    // place: exactly the information the event exists for.
    for (const kind of [31922, 31923]) {
      const r = clientPerEvento(preset('nostrudel'), evento({ kind, tags: [['d', 'x']] }))
      expect(r.client.id).toBe('coracle')
      expect(r.sostituito?.id).toBe('nostrudel')
    }
  })

  it('falls back on Coracle for the videos too', () => {
    for (const kind of [21, 22]) {
      expect(clientPerEvento(preset('nostrudel'), evento({ kind })).client.id).toBe('coracle')
    }
  })

  it('skips a fallback that cannot display the kind either', () => {
    // Coracle renders an empty page for the RSVPs: we end up at njump, which
    // at least produces a page.
    const r = clientPerEvento(preset('nostrudel'), evento({ kind: 31925, tags: [['d', 'x']] }))
    expect(r.client.id).toBe('njump')
  })

  it('does not fall back on itself', () => {
    const r = clientPerEvento(preset('coracle'), evento({ kind: 1063 }))
    expect(r.client.id).toBe('njump')
  })

  it('keeps the chosen client when no fallback does better', () => {
    const strano: ClientEsterno = {
      id: 'strano',
      nome: 'Strano',
      template: 'https://esempio.tld/{pointer}',
      kindsNonSupportati: [1],
      piattaforme: ['desktop'],
    }
    // With a list that holds no fallbacks, a button that shows the raw text
    // beats no button at all.
    const r = clientPerEvento(strano, evento({ kind: 1 }), [strano])
    expect(r.client.id).toBe('strano')
    expect(r.sostituito).toBeNull()
  })
})

describe('validating a hand-written template', () => {
  it('refuses the executable schemes', () => {
    // The template ends up in an href: an executable scheme would become
    // clickable code inside the page.
    expect(validaTemplate('javascript:alert(1)/{pointer}')).toMatch(/non ammesso/)
    expect(validaTemplate('data:text/html,{pointer}')).toMatch(/non ammesso/)
  })

  it("accepts https and the apps' schemes", () => {
    expect(validaTemplate('https://esempio.tld/{pointer}')).toBeNull()
    expect(validaTemplate('nostr:{pointer}')).toBeNull()
  })

  it('reports the missing placeholder and the empty template', () => {
    expect(validaTemplate('https://esempio.tld/')).toMatch(/segnaposto/)
    expect(validaTemplate('   ')).toMatch(/vuoto/)
  })

  it('refuses a template without a scheme', () => {
    expect(validaTemplate('esempio.tld/{pointer}')).toMatch(/schema/)
  })
})

describe('choosing the client', () => {
  it("falls back on the platform's default when the choice no longer exists", () => {
    // A preset can disappear between one version and the next: the user must
    // not end up with a button that opens nothing.
    expect(risolviClient('client-inventato', 'desktop').id).toBe(CLIENT_PREDEFINITO.desktop)
    expect(risolviClient(undefined, 'app').id).toBe(CLIENT_PREDEFINITO.app)
  })

  it('finds the clients added by hand', () => {
    const mio = {
      id: 'mio',
      nome: 'Il mio',
      template: 'https://mio.tld/{pointer}',
      piattaforme: ['desktop' as const],
    }
    expect(risolviClient('mio', 'desktop', [mio]).nome).toBe('Il mio')
  })

  it('has the declared defaults really exist among the presets', () => {
    for (const id of Object.values(CLIENT_PREDEFINITO)) {
      expect(clientEsterniPredefiniti.some((c) => c.id === id)).toBe(true)
    }
  })

  it('gives every preset a valid template', () => {
    for (const c of clientEsterniPredefiniti) {
      expect(validaTemplate(c.template), `${c.nome}: ${c.template}`).toBeNull()
    }
  })
})

describe('the podcast player', () => {
  const preset = (id: string): ClientEsterno =>
    clientEsterniPredefiniti.find((c) => c.id === id) as ClientEsterno

  it('falls back on Transmit for an episode, not on a social client', () => {
    // Coracle shows kind 54 as a raw event; a podcast player *plays* it. The
    // fallback depends on the kind, it is not a fixed list.
    const r = clientPerEvento(preset('nostrudel'), evento({ kind: 54 }))
    expect(r.client.id).toBe('transmit')
    expect(r.sostituito?.id).toBe('nostrudel')
  })

  it("opens the show's page, which is the author's key", () => {
    // Transmit does not have a page per event: the placeholder is {npub}.
    const link = linkEventoEsterno(preset('transmit'), evento({ kind: 54 }), RELAYS)
    expect(link).toMatch(/^https:\/\/www\.transmit\.fm\/shows\/npub1/)
    expect(decode(link.split('/shows/')[1] as string).data).toBe(PUBKEY)
  })

  it("holds for the show's card (10154) too", () => {
    expect(clientPerEvento(preset('nostrudel'), evento({ kind: 10154 })).client.id).toBe('transmit')
  })

  it('is never offered for a note: it is a player, not a client', () => {
    // A chosen client that can display the note stays; Transmit is not among
    // the notes' fallbacks and is not the default on any platform.
    expect(clientPerEvento(preset('transmit'), evento({ kind: 1 })).client.id).not.toBe('transmit')
    expect(preset('transmit').piattaforme).toEqual([])
  })

  it('makes a template with {npub} valid, and one without placeholders invalid', () => {
    expect(validaTemplate('https://esempio.tld/autori/{npub}')).toBeNull()
    expect(validaTemplate('https://esempio.tld/')).toMatch(/segnaposto/)
  })
})
