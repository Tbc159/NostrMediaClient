import { generateSecretKey } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'

import {
  cancellaBozza,
  draftIdentifier,
  unwrapDraft,
  unwrapPrivateRelays,
  wrapDraft,
  wrapPrivateRelays,
  SCADENZA_BOZZA_PREDEFINITA,
} from '../src/drafts/index.js'
import { selfCipher } from '../src/identity/cipher.js'
import { draftWrapDefinition, privateRelaysDefinition } from '../src/kinds/definitions/draft.js'
import type { NostrEvent } from '../src/kinds/types.js'

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }
const chiave = generateSecretKey()
const cifrario = selfCipher(chiave)

function evento(p: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'ff'.repeat(32),
    pubkey: CTX.pubkey,
    created_at: CTX.now,
    kind: 31234,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

const ARTICOLO = {
  kind: 30023,
  content: 'Testo riservato della bozza.',
  tags: [
    ['d', 'articolo-x'],
    ['title', 'Titolo provvisorio'],
  ],
  created_at: CTX.now,
}

describe('encrypted drafts (NIP-37)', () => {
  it('survives the encrypt → decrypt round trip keeping the event', async () => {
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)
    const riletto = draftWrapDefinition.parse(
      evento({ tags: template.tags, content: template.content }),
    )

    expect(await unwrapDraft(cifrario, riletto)).toEqual(ARTICOLO)
  })

  it('does not leave the content in the clear in the event', async () => {
    // It is the only reason NIP-37 exists: the kind 30024 it replaces ended up
    // on the relay readable by anyone with access to it.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)

    expect(template.content).not.toContain('Testo riservato')
    expect(template.content).not.toContain('Titolo provvisorio')
    expect(JSON.stringify(template.tags)).not.toContain('Titolo provvisorio')
  })

  it("declares the draft's kind in the k tag, not its own", async () => {
    // The reader needs it to know which form to open without having to
    // decrypt everything first.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)
    expect(template.tags).toContainEqual(['k', '30023'])
  })

  it('refuses a draft of a draft', async () => {
    await expect(
      wrapDraft(cifrario, 'x', { ...ARTICOLO, kind: 31234 }, { now: CTX.now }).then((i) =>
        draftWrapDefinition.build(i, CTX),
      ),
    ).rejects.toThrow(/non 31234/)
  })

  it('sets a ninety-day expiry, as the specification recommends', async () => {
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    expect(input.expiration).toBe(CTX.now + SCADENZA_BOZZA_PREDEFINITA)
  })

  it('allows setting none at all', async () => {
    // The NIP-40 expiry authorises the relay to delete: whoever keeps a draft
    // for more than three months has to be able to opt out of that.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now, expiration: null })
    expect(input.expiration).toBeUndefined()
    expect(draftWrapDefinition.build(input, CTX).tags.some((t) => t[0] === 'expiration')).toBe(
      false,
    )
  })

  it('reads an empty content as a deleted draft, not an empty one', async () => {
    // The specification says so, and it is the only way to delete one without
    // hoping the relay honours a kind 5 request.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(
      cancellaBozza(
        draftWrapDefinition.parse(
          evento({ tags: draftWrapDefinition.build(input, CTX).tags, content: input.ciphertext }),
        ),
      ),
      CTX,
    )

    const riletto = draftWrapDefinition.parse(evento({ tags: template.tags, content: '' }))
    expect(riletto.cancellata).toBe(true)
    expect(await unwrapDraft(cifrario, riletto)).toBeNull()
  })

  it('refuses to open a draft written with another key', async () => {
    // Going on would show invented data: better to say plainly that the key
    // is not the right one.
    const altro = selfCipher(generateSecretKey())
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const riletto = draftWrapDefinition.parse(
      evento({ tags: draftWrapDefinition.build(input, CTX).tags, content: input.ciphertext }),
    )

    await expect(unwrapDraft(altro, riletto)).rejects.toThrow(/altra identità/)
  })

  it('refuses to read an event without the k tag, which NIP-37 requires', () => {
    expect(() => draftWrapDefinition.parse(evento({ tags: [['d', 'x']], content: 'abc' }))).toThrow(
      /"k"/,
    )
  })
})

describe('private relays (kind 10013)', () => {
  it('keeps the addresses in the encrypted content, not in the tags', async () => {
    // The tags are public: knowing which relays a person keeps their drafts
    // on is already a piece of information.
    const ciphertext = await wrapPrivateRelays(cifrario, ['wss://privato.example'])
    const template = privateRelaysDefinition.build({ ciphertext }, CTX)

    // The only tag: the client's, which says nothing about where the drafts are.
    expect(template.tags).toEqual([['client', 'NostrMediaClient']])
    expect(template.content).not.toContain('privato.example')
  })

  it('survives the encrypt → decrypt round trip', async () => {
    const relays = ['wss://uno.example', 'wss://due.example']
    const ciphertext = await wrapPrivateRelays(cifrario, relays)
    expect(await unwrapPrivateRelays(cifrario, ciphertext)).toEqual(relays)
  })

  it('uses the private-tag form and not a plain list of strings', async () => {
    const ciphertext = await wrapPrivateRelays(cifrario, ['wss://uno.example'])
    const dentro = JSON.parse(await cifrario.decrypt(ciphertext))
    expect(dentro).toEqual([['relay', 'wss://uno.example']])
  })

  it('returns an empty list instead of throwing when it cannot be read', async () => {
    // An unreadable list must not stop drafts being saved: it falls back on
    // the local configuration.
    expect(await unwrapPrivateRelays(cifrario, '')).toEqual([])
    expect(await unwrapPrivateRelays(cifrario, 'non-cifrato')).toEqual([])
  })
})

describe("the wrapper's public identifier", () => {
  it('reveals nothing of the content', async () => {
    // The `d` tag is not encrypted: it is the only way the relay has of
    // knowing which version to replace. Deriving it from the title would undo
    // half the work — the content would stay unreadable, but whoever has
    // access to the relay would know what you are writing about.
    const id = await draftIdentifier('perche-nostr-e-interessante')
    expect(id).not.toContain('nostr')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic, so saving again replaces instead of duplicating', async () => {
    expect(await draftIdentifier('articolo-x')).toBe(await draftIdentifier('articolo-x'))
  })

  it('tells different drafts apart', async () => {
    expect(await draftIdentifier('uno')).not.toBe(await draftIdentifier('due'))
  })
})
