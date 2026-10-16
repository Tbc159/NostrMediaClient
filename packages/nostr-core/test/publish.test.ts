import { describe, expect, it } from 'vitest'

import { mergeRelayLists, normalizeRelayUrl } from '../src/relays/pool.js'
import { spiegaRispostaRelay, strategiaPerKind } from '../src/relays/publish.js'
import { ordinaPerData, ultimaVersione } from '../src/relays/request.js'
import type { NostrEvent } from '../src/kinds/types.js'

function evento(p: Partial<NostrEvent> & { id: string }): NostrEvent {
  return {
    pubkey: 'ab'.repeat(32),
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

describe("reading the relays' answers", () => {
  it('trusts the boolean, not the prefix', () => {
    // NIP-52 aside, it is the easiest mistake to make here: "duplicate:" and
    // "pow:" appear on positive answers too, and reading the prefix alone
    // would report a successful publication as failed.
    expect(spiegaRispostaRelay(true, 'pow: difficulty 25>=24').esito).toBe('accettato')
    expect(spiegaRispostaRelay(false, 'pow: difficulty 26 is less than 30').esito).toBe('rifiutato')
  })

  it('treats a duplicate as a success', () => {
    // The relay has it already: for the publisher the result is the same.
    const r = spiegaRispostaRelay(true, 'duplicate: already have this event')
    expect(r.esito).toBe('duplicato')
  })

  it('tells the request for authentication apart from a refusal', () => {
    // They are two situations with opposite remedies: one is solved by logging
    // in, the other is not.
    expect(
      spiegaRispostaRelay(false, 'auth-required: we only accept events from registered users')
        .esito,
    ).toBe('autenticazione')
    expect(spiegaRispostaRelay(false, 'restricted: not allowed to write.').esito).toBe('rifiutato')
  })

  it('reports the raw text when the relay uses no prefix at all', () => {
    // The specification requires one, but not every relay follows it.
    const r = spiegaRispostaRelay(false, 'no.')
    expect(r.esito).toBe('rifiutato')
    expect(r.motivo).toBe('no.')
  })

  it('does not leave an empty message unexplained', () => {
    expect(spiegaRispostaRelay(false, '').motivo).toMatch(/senza motivo/)
    expect(spiegaRispostaRelay(false, undefined).motivo).toMatch(/senza motivo/)
  })

  it("classifies the relay's error as unreachability, not as a refusal", () => {
    // "error:" is a fault of the relay's, not a judgement on the event:
    // retrying makes sense, correcting the event does not.
    expect(spiegaRispostaRelay(false, 'error: could not connect to the database').esito).toBe(
      'irraggiungibile',
    )
  })
})

describe('lists of relays', () => {
  it('does not query the same relay twice when it is written differently', () => {
    // The same URL with a trailing slash and capitals: two connections to the
    // same node rate-limit each other.
    const uniti = mergeRelayLists(
      ['wss://uno.example/', 'wss://due.example'],
      ['WSS://UNO.EXAMPLE'],
    )
    expect(uniti).toHaveLength(2)
  })

  it('keeps the original form of the first URL it meets', () => {
    // We normalise in order to compare, not to rewrite what the user has
    // configured.
    expect(mergeRelayLists(['wss://Uno.example'])[0]).toBe('wss://Uno.example')
    expect(normalizeRelayUrl('wss://Uno.example/')).toBe('wss://uno.example')
  })
})

describe('recomposing the events read', () => {
  const indirizzabile = (id: string, created_at: number, d = 'x'): NostrEvent =>
    evento({ id, created_at, kind: 31923, tags: [['d', d]] })

  it('keeps a single version of a replaceable event', () => {
    // Different relays can hold different versions: without this step the
    // same meeting would appear twice in the calendar.
    const risultato = ultimaVersione([indirizzabile('aa', 100), indirizzabile('bb', 200)])
    expect(risultato).toHaveLength(1)
    expect(risultato[0]?.id).toBe('bb')
  })

  it('picks the lower id on an equal instant, as NIP-01 wants', () => {
    // It is not aesthetics: it is what makes different clients converge on the
    // same version instead of each showing its own.
    const risultato = ultimaVersione([indirizzabile('bb', 100), indirizzabile('aa', 100)])
    expect(risultato[0]?.id).toBe('aa')
  })

  it('does not merge addressable events with different identifiers', () => {
    expect(
      ultimaVersione([indirizzabile('aa', 100, 'uno'), indirizzabile('bb', 100, 'due')]),
    ).toHaveLength(2)
  })

  it('does not merge the notes, which are regular and all distinct', () => {
    const note = [evento({ id: 'aa', created_at: 100 }), evento({ id: 'bb', created_at: 100 })]
    expect(ultimaVersione(note)).toHaveLength(2)
  })

  it('orders from the most recent', () => {
    const ordinati = ordinaPerData([
      evento({ id: 'aa', created_at: 100 }),
      evento({ id: 'bb', created_at: 300 }),
      evento({ id: 'cc', created_at: 200 }),
    ])
    expect(ordinati.map((e) => e.id)).toEqual(['bb', 'cc', 'aa'])
  })
})

describe('the strategy per kind', () => {
  it("has a note follow the user's preference", () => {
    expect(strategiaPerKind(1, 'sequenziale')).toBe('sequenziale')
    expect(strategiaPerKind(1, 'tutti')).toBe('tutti')
  })

  it('sends a podcast everywhere even with the rotation: a player reads from a relay of its own', () => {
    // A card on nos.lol is invisible to whoever reads relay.damus.io: it
    // really happened, and the rotation was the cause.
    for (const kind of [54, 10154, 10064])
      expect(strategiaPerKind(kind, 'sequenziale')).toBe('tutti')
  })

  it('sends replaceable and addressable everywhere: they have to be found, not merely to exist', () => {
    for (const kind of [0, 3, 10002, 30023, 31923]) {
      expect(strategiaPerKind(kind, 'sequenziale')).toBe('tutti')
    }
  })
})
