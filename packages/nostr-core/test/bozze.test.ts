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

describe('bozze cifrate (NIP-37)', () => {
  it('sopravvive al giro cifra → decifra conservando l' + "'evento", async () => {
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)
    const riletto = draftWrapDefinition.parse(
      evento({ tags: template.tags, content: template.content }),
    )

    expect(await unwrapDraft(cifrario, riletto)).toEqual(ARTICOLO)
  })

  it('non lascia il contenuto in chiaro nell' + "'evento", async () => {
    // E' l'unica ragione per cui NIP-37 esiste: il kind 30024 che sostituisce
    // finiva sul relay leggibile da chiunque vi accedesse.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)

    expect(template.content).not.toContain('Testo riservato')
    expect(template.content).not.toContain('Titolo provvisorio')
    expect(JSON.stringify(template.tags)).not.toContain('Titolo provvisorio')
  })

  it('dichiara nel tag k il kind della bozza, non il proprio', async () => {
    // Serve a chi legge per sapere quale form aprire senza dover prima
    // decifrare tutto.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const template = draftWrapDefinition.build(input, CTX)
    expect(template.tags).toContainEqual(['k', '30023'])
  })

  it('rifiuta una bozza di bozza', async () => {
    await expect(
      wrapDraft(cifrario, 'x', { ...ARTICOLO, kind: 31234 }, { now: CTX.now }).then((i) =>
        draftWrapDefinition.build(i, CTX),
      ),
    ).rejects.toThrow(/non 31234/)
  })

  it('mette una scadenza di novanta giorni, come raccomanda la specifica', async () => {
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    expect(input.expiration).toBe(CTX.now + SCADENZA_BOZZA_PREDEFINITA)
  })

  it('permette di non metterne nessuna', async () => {
    // La scadenza NIP-40 autorizza il relay a cancellare: chi tiene una bozza
    // per piu' di tre mesi deve poter rinunciare a quel comportamento.
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now, expiration: null })
    expect(input.expiration).toBeUndefined()
    expect(draftWrapDefinition.build(input, CTX).tags.some((t) => t[0] === 'expiration')).toBe(
      false,
    )
  })

  it('legge un content vuoto come bozza cancellata, non come bozza vuota', async () => {
    // Lo dice la specifica, ed e' l'unico modo per cancellarne una senza
    // sperare che il relay onori una richiesta kind 5.
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

  it('rifiuta di aprire una bozza scritta con un' + "'altra chiave", async () => {
    // Proseguire mostrerebbe dati inventati: meglio dire chiaramente che la
    // chiave non e' quella giusta.
    const altro = selfCipher(generateSecretKey())
    const input = await wrapDraft(cifrario, 'bozza-1', ARTICOLO, { now: CTX.now })
    const riletto = draftWrapDefinition.parse(
      evento({ tags: draftWrapDefinition.build(input, CTX).tags, content: input.ciphertext }),
    )

    await expect(unwrapDraft(altro, riletto)).rejects.toThrow(/altra identita/)
  })

  it('rifiuta in lettura un evento senza il tag k, che NIP-37 richiede', () => {
    expect(() => draftWrapDefinition.parse(evento({ tags: [['d', 'x']], content: 'abc' }))).toThrow(
      /"k"/,
    )
  })
})

describe('relay privati (kind 10013)', () => {
  it('tiene gli indirizzi nel content cifrato, non nei tag', async () => {
    // I tag sono pubblici: sapere su quali relay una persona tiene le bozze e'
    // gia' un'informazione.
    const ciphertext = await wrapPrivateRelays(cifrario, ['wss://privato.example'])
    const template = privateRelaysDefinition.build({ ciphertext }, CTX)

    expect(template.tags).toEqual([])
    expect(template.content).not.toContain('privato.example')
  })

  it('sopravvive al giro cifra → decifra', async () => {
    const relays = ['wss://uno.example', 'wss://due.example']
    const ciphertext = await wrapPrivateRelays(cifrario, relays)
    expect(await unwrapPrivateRelays(cifrario, ciphertext)).toEqual(relays)
  })

  it('usa la forma dei tag privati e non un semplice elenco di stringhe', async () => {
    const ciphertext = await wrapPrivateRelays(cifrario, ['wss://uno.example'])
    const dentro = JSON.parse(await cifrario.decrypt(ciphertext))
    expect(dentro).toEqual([['relay', 'wss://uno.example']])
  })

  it('restituisce un elenco vuoto invece di lanciare, se non si legge', async () => {
    // Un elenco illeggibile non deve impedire di salvare bozze: si ripiega
    // sulla configurazione locale.
    expect(await unwrapPrivateRelays(cifrario, '')).toEqual([])
    expect(await unwrapPrivateRelays(cifrario, 'non-cifrato')).toEqual([])
  })
})

describe('identificatore pubblico dell' + "'involucro", () => {
  it('non rivela nulla del contenuto', async () => {
    // Il tag `d` non e' cifrato: e' l'unico modo che il relay ha di sapere
    // quale versione sostituire. Derivarlo dal titolo vanificherebbe meta' del
    // lavoro — il contenuto resterebbe illeggibile, ma chi accede al relay
    // saprebbe di cosa stai scrivendo.
    const id = await draftIdentifier('perche-nostr-e-interessante')
    expect(id).not.toContain('nostr')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('e' + "' deterministico, cosi' risalvare sostituisce invece di duplicare", async () => {
    expect(await draftIdentifier('articolo-x')).toBe(await draftIdentifier('articolo-x'))
  })

  it('distingue bozze diverse', async () => {
    expect(await draftIdentifier('uno')).not.toBe(await draftIdentifier('due'))
  })
})
