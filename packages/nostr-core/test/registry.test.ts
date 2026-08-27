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

/** Definizione minima valida, da deformare caso per caso. */
function makeDefinition(overrides: Partial<AnyKindDefinition> = {}): AnyKindDefinition {
  const base: AnyKindDefinition = {
    kind: 1,
    name: 'nota-di-prova',
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

describe('registerKind — coerenze che il compilatore non puo imporre', () => {
  it('accetta una definizione coerente', () => {
    registerKind(makeDefinition())
    expect(isKnownKind(1)).toBe(true)
    expect(getKindDefinition(1)?.name).toBe('nota-di-prova')
  })

  it('rifiuta una classe che non corrisponde a quella derivata dal numero', () => {
    // 30023 e' addressable per NIP-01: dichiararlo regolare significherebbe
    // trattare come immutabile un evento che i relay sostituiscono.
    expect(() =>
      registerKind(makeDefinition({ kind: 30023, class: 'regular', name: 'articolo' })),
    ).toThrow(/NIP-01 la deriva come "addressable"/)
  })

  it('rifiuta editable=true su un kind regolare', () => {
    // E' il caso del kind 1: il protocollo non offre la modifica, e la UI
    // non deve simularla. Vedi sezione 1.1 del piano.
    expect(() => registerKind(makeDefinition({ kind: 1, editable: true }))).toThrow(
      /editable=true su una classe "regular"/,
    )
  })

  it('accetta editable=true su un kind addressable', () => {
    registerKind(
      makeDefinition({
        kind: 30023,
        class: 'addressable',
        name: 'articolo',
        editable: true,
        identifier: () => 'slug-articolo',
      }),
    )
    expect(getKindDefinition(30023)?.editable).toBe(true)
  })

  it('rifiuta un addressable senza identifier()', () => {
    // Senza tag `d` ogni nuovo evento sovrascriverebbe il precedente
    // dello stesso autore: perdita di dati silenziosa.
    expect(() =>
      registerKind(makeDefinition({ kind: 31923, class: 'addressable', name: 'evento' })),
    ).toThrow(/richiedono identifier\(\)/)
  })

  it('rifiuta identifier() su un kind non addressable', () => {
    expect(() => registerKind(makeDefinition({ kind: 1, identifier: () => 'x' }))).toThrow(
      /ha senso solo per gli eventi addressable/,
    )
  })

  it('rifiuta deletable=true su un kind ephemeral', () => {
    // I relay non conservano gli ephemeral: non c'e' nulla da cancellare.
    expect(() =>
      registerKind(
        makeDefinition({
          kind: 24242,
          class: 'ephemeral',
          name: 'auth-blossom',
          deletable: true,
        }),
      ),
    ).toThrow(/deletable=true su un kind ephemeral/)
  })

  it('rifiuta la registrazione doppia dello stesso kind', () => {
    registerKind(makeDefinition({ kind: 1, name: 'primo' }))
    expect(() => registerKind(makeDefinition({ kind: 1, name: 'secondo' }))).toThrow(
      /gia' registrato da "primo"/,
    )
  })
})

describe('interrogazione del registry', () => {
  it('elenca le definizioni ordinate per numero di kind', () => {
    registerKind(makeDefinition({ kind: 1111, class: 'regular', name: 'commento' }))
    registerKind(makeDefinition({ kind: 1, name: 'nota' }))
    registerKind(makeDefinition({ kind: 20, class: 'regular', name: 'picture' }))

    expect(allKindDefinitions().map((d) => d.kind)).toEqual([1, 20, 1111])
  })

  it('espone solo i kind marcati come idonei ai feed', () => {
    registerKind(makeDefinition({ kind: 1, name: 'nota', feed: { eligible: true } }))
    registerKind(makeDefinition({ kind: 20, name: 'picture', feed: { eligible: true } }))
    registerKind(makeDefinition({ kind: 5, name: 'cancellazione', feed: { eligible: false } }))
    registerKind(makeDefinition({ kind: 7, name: 'reazione' })) // feed assente

    expect(feedEligibleKinds()).toEqual([1, 20])
  })

  it('restituisce undefined per un kind sconosciuto, senza lanciare', () => {
    // Il client non deve rompersi davanti a un kind che non conosce:
    // il renderer di fallback si appoggia proprio a questo.
    expect(getKindDefinition(31337)).toBeUndefined()
    expect(isKnownKind(31337)).toBe(false)
  })
})

describe('defineKind', () => {
  it('preserva i parametri di tipo che un letterale nudo perderebbe', () => {
    const def = defineKind<{ content: string }, string>({
      kind: 1,
      name: 'nota',
      nip: 'NIP-10',
      class: 'regular',
      editable: false,
      deletable: true,
      schema: z.object({ content: z.string() }),
      parse: (event) => ({ content: event.content }),
      build: (input, ctx) => ({ kind: 1, content: input, tags: [], created_at: ctx.now }),
    })

    const built = def.build('ciao', { pubkey: 'ab'.repeat(32), now: 1_700_000_000 })
    expect(built).toEqual({ kind: 1, content: 'ciao', tags: [], created_at: 1_700_000_000 })
  })
})

describe('publishableKinds', () => {
  it('esclude gli effimeri, che un relay non conserva', () => {
    // Non e' prudenza: NIP-01 dice ai relay di non memorizzarli, quindi
    // interrogarli restituirebbe sempre il vuoto. Il 24242 di Blossom viene
    // firmato e spedito, ma dentro un header HTTP.
    clearRegistry()
    registerBuiltinKinds()

    const pubblicabili = publishableKinds()
    expect(pubblicabili).toContain(1)
    expect(pubblicabili).toContain(30023)
    expect(pubblicabili).not.toContain(24242)
  })

  it('cresce da solo quando si registra un kind nuovo', () => {
    // E' la promessa dell'intera struttura: aggiungere un kind non deve
    // richiedere di aggiornare gli elenchi sparsi per l'applicazione.
    clearRegistry()
    registerBuiltinKinds()
    const prima = publishableKinds().length

    registerKind({
      kind: 30078,
      name: 'dati-applicativi',
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

    expect(publishableKinds()).toHaveLength(prima + 1)
    expect(publishableKinds()).toContain(30078)
  })
})
