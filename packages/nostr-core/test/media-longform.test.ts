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

describe('the imeta tag (NIP-92)', () => {
  it('puts the key-value pairs inside a single entry, not in separate tags', () => {
    // It is the easiest NIP-92 mistake: the format resembles an ordinary tag
    // but is variadic, and nobody reads ['imeta','url','https://…'].
    const tag = buildImetaTag(FOTO)
    expect(tag[0]).toBe('imeta')
    expect(tag[1]).toBe('url https://cdn.example/foto.jpg')
    expect(tag).toContain('m image/jpeg')
  })

  it('does not break a description containing spaces', () => {
    // split(' ') would truncate the alt at the first word, and that is exactly
    // the field whoever cannot see the image needs.
    const alt = 'una barca ormeggiata al tramonto'
    const letto = parseImetaTag(buildImetaTag({ ...FOTO, alt }))
    expect(letto?.alt).toBe(alt)
  })

  it('refuses an imeta with the url alone', () => {
    // NIP-92 asks for at least one field besides url: without one the tag adds
    // nothing to what can already be read in the content.
    expect(() => buildImetaTag({ url: 'https://x/y.jpg' })).toThrow(/almeno un campo/)
  })

  it('refuses an imeta without a url', () => {
    expect(() => buildImetaTag({ url: '', mime: 'image/png' })).toThrow(/senza url/)
  })

  it('keeps several fallbacks and several previews', () => {
    const letto = parseImetaTag(
      buildImetaTag({ ...FOTO, fallback: ['https://a/1.jpg', 'https://b/1.jpg'] }),
    )
    expect(letto?.fallback).toHaveLength(2)
  })

  it('ignores a malformed imeta tag instead of failing the read', () => {
    const e = evento({ tags: [['imeta', 'roba senza senso'], buildImetaTag(FOTO)] })
    expect(imetaOf(e)).toHaveLength(1)
  })
})

describe('kind 20 — a post with images', () => {
  it('refuses a post without images', () => {
    // A kind 20 without attachments is a note in disguise: clients filtering
    // for kind 20 expect a gallery.
    expect(() => pictureDefinition.build({ content: 'ciao', images: [] }, CTX)).toThrow(
      /almeno un’immagine/,
    )
  })

  it('repeats the type and the hashes outside the imeta, because filters do not read inside variadic tags', () => {
    const t = pictureDefinition.build({ content: '', images: [FOTO] }, CTX)
    expect(t.tags).toContainEqual(['m', 'image/jpeg'])
    expect(t.tags).toContainEqual(['x', 'aa'.repeat(32)])
  })

  it('does not repeat the same MIME type for every image', () => {
    const t = pictureDefinition.build(
      { content: '', images: [FOTO, { ...FOTO, url: 'https://cdn.example/2.jpg' }] },
      CTX,
    )
    expect(t.tags.filter((x) => x[0] === 'm')).toHaveLength(1)
  })

  it('survives the build → parse round trip', () => {
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

  it('demands the title, which NIP-71 makes mandatory', () => {
    expect(() => videoDefinition.build({ title: '  ', variants: [VIDEO] }, CTX)).toThrow(/titolo/)
  })

  it('demands at least one variant of the file', () => {
    expect(() => videoDefinition.build({ title: 'Prova', variants: [] }, CTX)).toThrow(/variante/)
  })

  it('keeps the duration, which is decimal and not whole', () => {
    const t = videoDefinition.build({ title: 'Prova', variants: [VIDEO] }, CTX)
    const letto = videoDefinition.parse(evento({ kind: 21, tags: t.tags, content: t.content }))
    expect(letto.variants[0]?.duration).toBeCloseTo(29.2)
  })
})

describe('kind 1063 — file metadata', () => {
  it("keeps the served file's hash and the original's apart", () => {
    // If the server recompresses, the two diverge: confusing them means never
    // finding the uploaded file again.
    const t = fileMetadataDefinition.build(
      { url: FOTO.url, sha256: 'aa'.repeat(32), sha256Originale: 'bb'.repeat(32) },
      CTX,
    )
    const letto = fileMetadataDefinition.parse(evento({ kind: 1063, tags: t.tags }))
    expect(letto.sha256).toBe('aa'.repeat(32))
    expect(letto.sha256Originale).toBe('bb'.repeat(32))
  })

  it('refuses to read an event without a url', () => {
    expect(() => fileMetadataDefinition.parse(evento({ kind: 1063, tags: [] }))).toThrow(/"url"/)
  })
})

describe('kind 30023 — an article', () => {
  const base = { identifier: 'primo-articolo', content: 'Testo in **Markdown**.' }

  it('is editable: it is addressable', () => {
    expect(articleDefinition.editable).toBe(true)
    expect(articleDefinition.class).toBe('addressable')
  })

  it('refuses HTML inside the Markdown, as NIP-23 requires', () => {
    expect(() =>
      articleDefinition.build({ ...base, content: 'testo <script>alert(1)</script>' }, CTX),
    ).toThrow(/HTML/)
  })

  it('refuses an empty identifier', () => {
    // Without a `d` tag an edit would create a duplicate instead of replacing.
    expect(() => articleDefinition.build({ ...base, identifier: '  ' }, CTX)).toThrow(
      /identificatore/,
    )
  })

  it('keeps the first publication date when it is edited', () => {
    // created_at is the last edit, published_at the first outing: updating the
    // second would push the article back up other people's feeds on every
    // correction.
    const prima = articleDefinition.build(base, CTX)
    const pubblicato = prima.tags.find((t) => t[0] === 'published_at')?.[1]

    const dopo = articleDefinition.build(
      { ...base, content: 'Testo corretto.', publishedAt: Number(pubblicato) },
      { ...CTX, now: CTX.now + 86_400 },
    )
    expect(dopo.tags.find((t) => t[0] === 'published_at')?.[1]).toBe(pubblicato)
    expect(dopo.created_at).toBe(CTX.now + 86_400)
  })

  it('derives a readable identifier from the title', () => {
    expect(slugFromTitle('Perché Nostr è interessante')).toBe('perche-nostr-e-interessante')
  })

  it('does not produce an empty identifier from a title of symbols alone', () => {
    expect(slugFromTitle('!!! ???').length).toBeGreaterThan(0)
  })
})

describe('the Blossom authorization (BUD-11)', () => {
  const base = { verb: 'upload' as const, content: 'Carica un file', hashes: ['aa'.repeat(32)] }

  it('refuses an expiry already in the past', () => {
    // An expired token is of no use; one without an expiry would be worse.
    expect(() => blossomAuthDefinition.build({ ...base, expiration: CTX.now - 1 }, CTX)).toThrow(
      /futuro/,
    )
  })

  it('demands the hash on the upload tokens', () => {
    expect(() =>
      blossomAuthDefinition.build({ ...base, hashes: [], expiration: CTX.now + 300 }, CTX),
    ).toThrow(/hash/)
  })

  it('demands a readable description', () => {
    // It is the text the extension shows the user: empty means asking them to
    // authorize something they cannot understand.
    expect(() =>
      blossomAuthDefinition.build({ ...base, content: '', expiration: CTX.now + 300 }, CTX),
    ).toThrow(/spiegare/)
  })

  it('refuses a full URL in the server tag, which wants the domain alone', () => {
    expect(() =>
      blossomAuthDefinition.build(
        { ...base, expiration: CTX.now + 300, servers: ['https://cdn.example/'] },
        CTX,
      ),
    ).toThrow(/dominio/)
  })

  it('is ephemeral: it must not be published to a relay', () => {
    expect(blossomAuthDefinition.class).toBe('ephemeral')
  })
})

describe('the Blossom transport', () => {
  it('encodes the token in base64url without padding', () => {
    // The standard variant uses + and /, which inside an HTTP header run into
    // over-zealous proxies and parsers.
    const header = encodeAuthHeader(evento({ kind: 24242, content: 'Carica un file àèì' }))
    expect(header.startsWith('Nostr ')).toBe(true)
    const token = header.slice(6)
    expect(token).not.toMatch(/[+/=]/)
  })

  it('extracts the host name alone for the server tag', () => {
    expect(hostDi('https://CDN.Example.com/percorso/')).toBe('cdn.example.com')
  })

  it('computes the SHA-256 of the bytes', async () => {
    // A known vector: the hash of the empty string.
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
