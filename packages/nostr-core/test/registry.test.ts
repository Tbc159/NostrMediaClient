import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  allKindDefinitions,
  clearRegistry,
  defineKind,
  feedEligibleKinds,
  getKindDefinition,
  isKnownKind,
  publishableKinds,
  registerKind,
} from '../src/kinds/registry.js'
import { registerBuiltinKinds } from '../src/kinds/definitions/index.js'
import type { AnyKindDefinition, EventClass } from '../src/kinds/types.js'

/** A minimal valid definition, to be deformed case by case. */
function makeDefinition(overrides: Partial<AnyKindDefinition> = {}): AnyKindDefinition {
  const base: AnyKindDefinition = {
    kind: 1,
    name: 'test-note',
    nip: 'NIP-10',
    class: 'regular' as EventClass,
    editable: false,
    deletable: true,
    schema: z.object({ content: z.string() }),
    parse: (event) => ({ content: event.content }),
    build: (input, ctx) => ({
      kind: 1,
      content: String(input),
      tags: [],
      created_at: ctx.now,
    }),
  }
  return { ...base, ...overrides }
}

beforeEach(() => {
  clearRegistry()
})

describe('registerKind — consistencies the compiler cannot enforce', () => {
  it('accepts a consistent definition', () => {
    registerKind(makeDefinition())
    expect(isKnownKind(1)).toBe(true)
    expect(getKindDefinition(1)?.name).toBe('test-note')
  })

  it('refuses a class that does not match the one derived from the number', () => {
    // 30023 is addressable under NIP-01: declaring it regular would mean
    // treating as immutable an event that relays replace.
    expect(() =>
      registerKind(makeDefinition({ kind: 30023, class: 'regular', name: 'article' })),
    ).toThrow(/NIP-01 derives it as "addressable"/)
  })

  it('refuses editable=true on a regular kind', () => {
    // This is kind 1's case: the protocol offers no editing, and the UI must
    // not simulate it. See section 1.1 of the plan.
    expect(() => registerKind(makeDefinition({ kind: 1, editable: true }))).toThrow(
      /editable=true on a "regular" class/,
    )
  })

  it('accepts editable=true on an addressable kind', () => {
    registerKind(
      makeDefinition({
        kind: 30023,
        class: 'addressable',
        name: 'article',
        editable: true,
        identifier: () => 'article-slug',
      }),
    )
    expect(getKindDefinition(30023)?.editable).toBe(true)
  })

  it('refuses an addressable without identifier()', () => {
    // Without a `d` tag every new event would overwrite the same author's
    // previous one: silent data loss.
    expect(() =>
      registerKind(makeDefinition({ kind: 31923, class: 'addressable', name: 'event' })),
    ).toThrow(/require identifier\(\)/)
  })

  it('refuses identifier() on a kind that is not addressable', () => {
    expect(() => registerKind(makeDefinition({ kind: 1, identifier: () => 'x' }))).toThrow(
      /only makes sense for addressable events/,
    )
  })

  it('refuses deletable=true on an ephemeral kind', () => {
    // Relays do not keep ephemerals: there is nothing to delete.
    expect(() =>
      registerKind(
        makeDefinition({
          kind: 24242,
          class: 'ephemeral',
          name: 'blossom-auth',
          deletable: true,
        }),
      ),
    ).toThrow(/deletable=true on an ephemeral kind/)
  })

  it('refuses registering the same kind twice', () => {
    registerKind(makeDefinition({ kind: 1, name: 'first' }))
    expect(() => registerKind(makeDefinition({ kind: 1, name: 'second' }))).toThrow(
      /is already registered by "first"/,
    )
  })
})

describe('querying the registry', () => {
  it('lists the definitions ordered by kind number', () => {
    registerKind(makeDefinition({ kind: 1111, class: 'regular', name: 'comment' }))
    registerKind(makeDefinition({ kind: 1, name: 'note' }))
    registerKind(makeDefinition({ kind: 20, class: 'regular', name: 'picture' }))

    expect(allKindDefinitions().map((d) => d.kind)).toEqual([1, 20, 1111])
  })

  it('exposes only the kinds marked as feed-eligible', () => {
    registerKind(makeDefinition({ kind: 1, name: 'note', feed: { eligible: true } }))
    registerKind(makeDefinition({ kind: 20, name: 'picture', feed: { eligible: true } }))
    registerKind(makeDefinition({ kind: 5, name: 'deletion', feed: { eligible: false } }))
    registerKind(makeDefinition({ kind: 7, name: 'reaction' })) // no feed field

    expect(feedEligibleKinds()).toEqual([1, 20])
  })

  it('returns undefined for an unknown kind, without throwing', () => {
    // The client must not break in front of a kind it does not know: the
    // fallback renderer relies on exactly this.
    expect(getKindDefinition(31337)).toBeUndefined()
    expect(isKnownKind(31337)).toBe(false)
  })
})

describe('defineKind', () => {
  it('preserves the type parameters a bare literal would lose', () => {
    const def = defineKind<{ content: string }, string>({
      kind: 1,
      name: 'note',
      nip: 'NIP-10',
      class: 'regular',
      editable: false,
      deletable: true,
      schema: z.object({ content: z.string() }),
      parse: (event) => ({ content: event.content }),
      build: (input, ctx) => ({ kind: 1, content: input, tags: [], created_at: ctx.now }),
    })

    const built = def.build('hello', { pubkey: 'ab'.repeat(32), now: 1_700_000_000 })
    expect(built).toEqual({
      kind: 1,
      content: 'hello',
      // defineKind is no longer just an identity: it adds the `client` tag,
      // which is why no kind can forget it.
      tags: [['client', 'NostrMediaClient']],
      created_at: 1_700_000_000,
    })
  })
})

describe('publishableKinds', () => {
  it('excludes ephemerals, which a relay does not keep', () => {
    // Not caution: NIP-01 tells relays not to store them, so querying would
    // always come back empty. Blossom's 24242 is signed and sent, but inside
    // an HTTP header.
    clearRegistry()
    registerBuiltinKinds()

    const publishable = publishableKinds()
    expect(publishable).toContain(1)
    expect(publishable).toContain(30023)
    expect(publishable).not.toContain(24242)
  })

  it('grows by itself when a new kind is registered', () => {
    // It is the promise of the whole structure: adding a kind must not
    // require updating lists scattered across the application.
    clearRegistry()
    registerBuiltinKinds()
    const before = publishableKinds().length

    registerKind({
      kind: 30078,
      name: 'app-data',
      nip: 'NIP-78',
      class: 'addressable',
      editable: true,
      deletable: true,
      schema: z.object({}),
      identifier: () => 'x',
      parse: () => ({}),
      build: (_input, ctx) => ({
        kind: 30078,
        content: '',
        tags: [['d', 'x']],
        created_at: ctx.now,
      }),
    })

    expect(publishableKinds()).toHaveLength(before + 1)
    expect(publishableKinds()).toContain(30078)
  })
})
