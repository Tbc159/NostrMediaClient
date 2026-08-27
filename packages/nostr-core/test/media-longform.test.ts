import { describe, expect, it } from 'vitest'

import { buildImetaTag, imetaOf, parseImetaTag } from '../src/kinds/imeta.js'
import { articleDefinition, slugFromTitle } from '../src/kinds/definitions/article.js'
import { blossomAuthDefinition } from '../src/kinds/definitions/blossom-auth.js'
import { fileMetadataDefinition } from '../src/kinds/definitions/file-metadata.js'
import { pictureDefinition } from '../src/kinds/definitions/picture.js'
import { videoDefinition } from '../src/kinds/definitions/video.js'
import type { NostrEvent } from '../src/kinds/types.js'
import { encodeAuthHeader, hostDi, sha256Hex } from '../src/media/blossom.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }

function evento(p: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: CTX.pubkey,
    created_at: CTX.now,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

const FOTO = { url: 'https://cdn.example/foto.jpg', mime: 'image/jpeg', sha256: 'aa'.repeat(32) }

describe('tag imeta (NIP-92)', () => {
  it('mette le coppie chiave-valore dentro una sola voce, non in tag separati', () => {
    // E' l'errore piu' facile di NIP-92: il formato ricorda un tag normale ma
    // e' variadico, e ['imeta','url','https://…'] non lo legge nessuno.
    const tag = buildImetaTag(FOTO)
    expect(tag[0]).toBe('imeta')
    expect(tag[1]).toBe('url https://cdn.example/foto.jpg')
    expect(tag).toContain('m image/jpeg')
  })

  it('non spezza una descrizione che contiene spazi', () => {
    // split(' ') troncherebbe l'alt alla prima parola, che e' proprio il campo
    // di cui ha bisogno chi non vede l'immagine.
    const alt = 'una barca ormeggiata al tramonto'
    const letto = parseImetaTag(buildImetaTag({ ...FOTO, alt }))
    expect(letto?.alt).toBe(alt)
  })

  it('rifiuta un imeta con la sola url', () => {
    // NIP-92 chiede almeno un campo oltre a url: senza, il tag non aggiunge
    // niente a quello che si legge gia' nel content.
    expect(() => buildImetaTag({ url: 'https://x/y.jpg' })).toThrow(/almeno un campo/)
  })

  it('rifiuta un imeta senza url', () => {
    expect(() => buildImetaTag({ url: '', mime: 'image/png' })).toThrow(/senza url/)
  })

  it('conserva piu' + ' fallback e piu' + ' anteprime', () => {
    const letto = parseImetaTag(
      buildImetaTag({ ...FOTO, fallback: ['https://a/1.jpg', 'https://b/1.jpg'] }),
    )
    expect(letto?.fallback).toHaveLength(2)
  })

  it('ignora un tag imeta malformato invece di far fallire la lettura', () => {
    const e = evento({ tags: [['imeta', 'roba senza senso'], buildImetaTag(FOTO)] })
    expect(imetaOf(e)).toHaveLength(1)
  })
})

describe('kind 20 — post con immagini', () => {
  it('rifiuta un post senza immagini', () => {
    // Un kind 20 senza allegati e' una nota travestita: i client che filtrano
    // per kind 20 si aspettano una galleria.
    expect(() => pictureDefinition.build({ content: 'ciao', images: [] }, CTX)).toThrow(
      /almeno un’immagine/,
    )
  })

  it(
    'ripete tipo e hash fuori dall' + "'imeta, perche' i filtri non leggono dentro i tag variadici",
    () => {
      const t = pictureDefinition.build({ content: '', images: [FOTO] }, CTX)
      expect(t.tags).toContainEqual(['m', 'image/jpeg'])
      expect(t.tags).toContainEqual(['x', 'aa'.repeat(32)])
    },
  )

  it('non ripete lo stesso tipo MIME per ogni immagine', () => {
    const t = pictureDefinition.build(
      { content: '', images: [FOTO, { ...FOTO, url: 'https://cdn.example/2.jpg' }] },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'm')).toHaveLength(1)
  })

  it('sopravvive al giro build → parse', () => {
    const t = pictureDefinition.build(
      { content: 'descrizione', title: 'Titolo', images: [{ ...FOTO, alt: 'una foto' }] },
      CTX,
    )
    const letto = pictureDefinition.parse(evento({ kind: 20, tags: t.tags, content: t.content }))
    expect(letto.title).toBe('Titolo')
    expect(letto.images[0]?.alt).toBe('una foto')
  })
})

describe('kind 21 — video', () => {
  const VIDEO = { url: 'https://cdn.example/v.mp4', mime: 'video/mp4', duration: 29.2 }

  it('pretende il titolo, che NIP-71 rende obbligatorio', () => {
    expect(() => videoDefinition.build({ title: '  ', variants: [VIDEO] }, CTX)).toThrow(/titolo/)
  })

  it('pretende almeno una variante del file', () => {
    expect(() => videoDefinition.build({ title: 'Prova', variants: [] }, CTX)).toThrow(/variante/)
  })

  it('conserva la durata, che e' + ' decimale e non intera', () => {
    const t = videoDefinition.build({ title: 'Prova', variants: [VIDEO] }, CTX)
    const letto = videoDefinition.parse(evento({ kind: 21, tags: t.tags, content: t.content }))
    expect(letto.variants[0]?.duration).toBeCloseTo(29.2)
  })
})

describe('kind 1063 — metadati file', () => {
  it('tiene distinti l' + "'hash del file servito e quello dell'originale", () => {
    // Se il server ricomprime, i due divergono: confonderli significa non
    // ritrovare piu' il file che si e' caricato.
    const t = fileMetadataDefinition.build(
      { url: FOTO.url, sha256: 'aa'.repeat(32), sha256Originale: 'bb'.repeat(32) },
      CTX,
    )
    const letto = fileMetadataDefinition.parse(evento({ kind: 1063, tags: t.tags }))
    expect(letto.sha256).toBe('aa'.repeat(32))
    expect(letto.sha256Originale).toBe('bb'.repeat(32))
  })

  it('rifiuta in lettura un evento senza url', () => {
    expect(() => fileMetadataDefinition.parse(evento({ kind: 1063, tags: [] }))).toThrow(/"url"/)
  })
})

describe('kind 30023 — articolo', () => {
  const base = { identifier: 'primo-articolo', content: 'Testo in **Markdown**.' }

  it('e' + ' modificabile: e' + "' addressable", () => {
    expect(articleDefinition.editable).toBe(true)
    expect(articleDefinition.class).toBe('addressable')
  })

  it('rifiuta HTML dentro il Markdown, come impone NIP-23', () => {
    expect(() =>
      articleDefinition.build({ ...base, content: 'testo <script>alert(1)</script>' }, CTX),
    ).toThrow(/HTML/)
  })

  it('rifiuta un identificatore vuoto', () => {
    // Senza tag `d` la modifica creerebbe un doppione invece di sostituire.
    expect(() => articleDefinition.build({ ...base, identifier: '  ' }, CTX)).toThrow(
      /identificatore/,
    )
  })

  it('conserva la data di prima pubblicazione quando si modifica', () => {
    // created_at e' l'ultima modifica, published_at la prima uscita: aggiornare
    // il secondo farebbe risalire l'articolo nei feed altrui a ogni correzione.
    const prima = articleDefinition.build(base, CTX)
    const pubblicato = prima.tags.find((t) => t[0] === 'published_at')?.[1]

    const dopo = articleDefinition.build(
      { ...base, content: 'Testo corretto.', publishedAt: Number(pubblicato) },
      { ...CTX, now: CTX.now + 86_400 },
    )
    expect(dopo.tags.find((t) => t[0] === 'published_at')?.[1]).toBe(pubblicato)
    expect(dopo.created_at).toBe(CTX.now + 86_400)
  })

  it('ricava un identificatore leggibile dal titolo', () => {
    expect(slugFromTitle('Perché Nostr è interessante')).toBe('perche-nostr-e-interessante')
  })

  it('non produce un identificatore vuoto da un titolo di soli simboli', () => {
    expect(slugFromTitle('!!! ???').length).toBeGreaterThan(0)
  })
})

describe('autorizzazione Blossom (BUD-11)', () => {
  const base = { verb: 'upload' as const, content: 'Carica un file', hashes: ['aa'.repeat(32)] }

  it('rifiuta una scadenza gia' + ' passata', () => {
    // Un token scaduto non serve a nulla; uno senza scadenza sarebbe peggio.
    expect(() => blossomAuthDefinition.build({ ...base, expiration: CTX.now - 1 }, CTX)).toThrow(
      /futuro/,
    )
  })

  it('pretende l' + "'hash sui token di upload", () => {
    expect(() =>
      blossomAuthDefinition.build({ ...base, hashes: [], expiration: CTX.now + 300 }, CTX),
    ).toThrow(/hash/)
  })

  it('pretende una descrizione leggibile', () => {
    // E' il testo che l'estensione mostra all'utente: vuoto significa
    // chiedergli di autorizzare qualcosa che non puo' capire.
    expect(() =>
      blossomAuthDefinition.build({ ...base, content: '', expiration: CTX.now + 300 }, CTX),
    ).toThrow(/spiegare/)
  })

  it('rifiuta un URL completo nel tag server, che vuole il solo dominio', () => {
    expect(() =>
      blossomAuthDefinition.build(
        { ...base, expiration: CTX.now + 300, servers: ['https://cdn.example/'] },
        CTX,
      ),
    ).toThrow(/dominio/)
  })

  it('e' + "' effimero: non va pubblicato su un relay", () => {
    expect(blossomAuthDefinition.class).toBe('ephemeral')
  })
})

describe('trasporto Blossom', () => {
  it('codifica il token in base64url senza padding', () => {
    // La variante standard usa + e /, che dentro un header HTTP incontrano
    // proxy e parser troppo zelanti.
    const header = encodeAuthHeader(evento({ kind: 24242, content: 'Carica un file àèì' }))
    expect(header.startsWith('Nostr ')).toBe(true)
    const token = header.slice(6)
    expect(token).not.toMatch(/[+/=]/)
  })

  it('estrae il solo nome host per il tag server', () => {
    expect(hostDi('https://CDN.Example.com/percorso/')).toBe('cdn.example.com')
  })

  it('calcola lo SHA-256 dei byte', async () => {
    // Vettore noto: l'hash della stringa vuota.
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
