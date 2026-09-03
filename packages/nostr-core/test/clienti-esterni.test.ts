import { decode } from 'nostr-tools/nip19'
import { describe, expect, it } from 'vitest'

import {
  CLIENT_PREDEFINITO,
  clientEsterniPredefiniti,
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

describe('identificatore per i client esterni', () => {
  it('usa naddr per gli eventi modificabili, non nevent', () => {
    // Un nevent punta a *quella* versione: appena l'evento viene modificato il
    // link mostrerebbe la versione superata, o niente.
    const pointer = nip19PointerFor(evento({ kind: 30023, tags: [['d', 'articolo-x']] }), RELAYS)
    const decodificato = decode(pointer)

    expect(decodificato.type).toBe('naddr')
    expect(decodificato.data).toMatchObject({
      kind: 30023,
      identifier: 'articolo-x',
      pubkey: PUBKEY,
    })
  })

  it('usa nprofile per il kind 0, che nei client e' + ' una pagina profilo', () => {
    const decodificato = decode(nip19PointerFor(evento({ kind: 0 }), RELAYS))
    expect(decodificato.type).toBe('nprofile')
    expect(decodificato.data).toMatchObject({ pubkey: PUBKEY })
  })

  it('usa nevent per gli eventi regolari', () => {
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), RELAYS))
    expect(decodificato.type).toBe('nevent')
    expect(decodificato.data).toMatchObject({ id: 'ff'.repeat(32), kind: 1 })
  })

  it('porta i relay come suggerimenti', () => {
    // Senza, il client esterno cerca l'evento solo sui propri relay e spesso
    // non lo trova: e' la differenza fra un link che funziona e uno che apre
    // una pagina vuota.
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), RELAYS))
    expect((decodificato.data as { relays?: string[] }).relays).toEqual(RELAYS)
  })

  it('non ne mette piu' + ' di tre, e senza doppioni', () => {
    const molti = ['wss://a', 'wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e']
    const decodificato = decode(nip19PointerFor(evento({ kind: 1 }), molti))
    expect((decodificato.data as { relays?: string[] }).relays).toEqual([
      'wss://a',
      'wss://b',
      'wss://c',
    ])
  })

  it('funziona anche senza relay', () => {
    expect(() => nip19PointerFor(evento({ kind: 1 }))).not.toThrow()
  })
})

describe('composizione del link', () => {
  it('sostituisce il segnaposto', () => {
    expect(componiLinkEsterno('https://esempio.tld/{pointer}', 'nevent1abc')).toBe(
      'https://esempio.tld/nevent1abc',
    )
  })

  it('rifiuta un modello senza segnaposto', () => {
    // Senza, ogni evento aprirebbe la stessa pagina: un guasto silenzioso.
    expect(() => componiLinkEsterno('https://esempio.tld/', 'nevent1abc')).toThrow(/\{pointer\}/)
  })

  it('conserva un modello passato come stringa, per l' + "'anteprima nelle impostazioni", () => {
    const link = linkEventoEsterno('https://esempio.tld/x/{pointer}', evento({ kind: 1 }), RELAYS)
    expect(link).toMatch(/^https:\/\/esempio\.tld\/x\/nevent1/)
  })

  it('compone lo schema nostr: di NIP-21', () => {
    const link = linkEventoEsterno('nostr:{pointer}', evento({ kind: 1 }))
    expect(link).toMatch(/^nostr:nevent1/)
  })
})

describe('percorsi che dipendono dalla forma del puntatore', () => {
  const preset = (id: string): ClientEsterno =>
    clientEsterniPredefiniti.find((c) => c.id === id) as ClientEsterno

  it('sceglie la forma giusta per ogni classe di evento', () => {
    expect(tipoPuntatorePer(evento({ kind: 0 }))).toBe('nprofile')
    expect(tipoPuntatorePer(evento({ kind: 30023, tags: [['d', 'x']] }))).toBe('naddr')
    expect(tipoPuntatorePer(evento({ kind: 1 }))).toBe('nevent')
    expect(tipoPuntatorePer(evento({ kind: 54 }))).toBe('nevent')
  })

  it('noStrudel usa /l/, che smista da solo le tre forme', () => {
    // Il percorso /n/ e' la vista di una *nota*: con un naddr risponde
    // «Unknown type naddr», e con un nprofile «Unknown type nprofile».
    // Verificato caricando entrambi i percorsi in un browser.
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

  it('Primal manda i profili su /p/ e tutto il resto su /e/', () => {
    // /e/ con un nprofile restituisce «404 Page not found».
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

  it('un client senza forme a parte usa lo stesso modello per tutto', () => {
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

describe('validazione di un modello scritto a mano', () => {
  it('rifiuta gli schemi eseguibili', () => {
    // Il modello finisce in un href: uno schema eseguibile diventerebbe
    // codice cliccabile dentro la pagina.
    expect(validaTemplate('javascript:alert(1)/{pointer}')).toMatch(/non ammesso/)
    expect(validaTemplate('data:text/html,{pointer}')).toMatch(/non ammesso/)
  })

  it('accetta https e gli schemi delle app', () => {
    expect(validaTemplate('https://esempio.tld/{pointer}')).toBeNull()
    expect(validaTemplate('nostr:{pointer}')).toBeNull()
  })

  it('segnala il segnaposto mancante e il modello vuoto', () => {
    expect(validaTemplate('https://esempio.tld/')).toMatch(/segnaposto/)
    expect(validaTemplate('   ')).toMatch(/vuoto/)
  })

  it('rifiuta un modello senza schema', () => {
    expect(validaTemplate('esempio.tld/{pointer}')).toMatch(/schema/)
  })
})

describe('scelta del client', () => {
  it('ricade sul predefinito della piattaforma se la scelta non esiste piu' + "'", () => {
    // Un preset puo' sparire fra una versione e l'altra: l'utente non deve
    // ritrovarsi con un pulsante che non apre nulla.
    expect(risolviClient('client-inventato', 'desktop').id).toBe(CLIENT_PREDEFINITO.desktop)
    expect(risolviClient(undefined, 'app').id).toBe(CLIENT_PREDEFINITO.app)
  })

  it('trova i client aggiunti a mano', () => {
    const mio = {
      id: 'mio',
      nome: 'Il mio',
      template: 'https://mio.tld/{pointer}',
      piattaforme: ['desktop' as const],
    }
    expect(risolviClient('mio', 'desktop', [mio]).nome).toBe('Il mio')
  })

  it('i predefiniti dichiarati esistono davvero fra i preset', () => {
    for (const id of Object.values(CLIENT_PREDEFINITO)) {
      expect(clientEsterniPredefiniti.some((c) => c.id === id)).toBe(true)
    }
  })

  it('ogni preset ha un modello valido', () => {
    for (const c of clientEsterniPredefiniti) {
      expect(validaTemplate(c.template), `${c.nome}: ${c.template}`).toBeNull()
    }
  })
})
