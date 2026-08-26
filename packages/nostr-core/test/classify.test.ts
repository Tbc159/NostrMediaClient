import { describe, expect, it } from 'vitest'

import { classifyKind, isReplaceableClass } from '../src/kinds/classify.js'

describe('classifyKind', () => {
  it('tratta 0 e 3 come replaceable, benche stiano sotto 1000', () => {
    // Sono le eccezioni esplicite di NIP-01: precedono la formalizzazione
    // delle fasce e non seguono la regola numerica.
    expect(classifyKind(0)).toBe('replaceable') // profilo
    expect(classifyKind(3)).toBe('replaceable') // lista follow
  })

  it('tratta 1 e 2 come regolari', () => {
    expect(classifyKind(1)).toBe('regular') // nota breve
    expect(classifyKind(2)).toBe('regular') // relay consigliato, deprecato
  })

  it('tratta la fascia 4..44 come regolare', () => {
    expect(classifyKind(4)).toBe('regular') // DM legacy
    expect(classifyKind(20)).toBe('regular') // picture (NIP-68)
    expect(classifyKind(21)).toBe('regular') // video
    expect(classifyKind(22)).toBe('regular') // video verticale
    expect(classifyKind(44)).toBe('regular')
  })

  it('applica le fasce numeriche di NIP-01', () => {
    expect(classifyKind(1000)).toBe('regular')
    expect(classifyKind(1063)).toBe('regular') // file metadata
    expect(classifyKind(1111)).toBe('regular') // commento
    expect(classifyKind(9999)).toBe('regular')

    expect(classifyKind(10000)).toBe('replaceable') // mute list
    expect(classifyKind(10002)).toBe('replaceable') // relay list, NIP-65
    expect(classifyKind(10063)).toBe('replaceable') // server Blossom
    expect(classifyKind(19999)).toBe('replaceable')

    expect(classifyKind(20000)).toBe('ephemeral')
    expect(classifyKind(24242)).toBe('ephemeral') // auth Blossom
    expect(classifyKind(29999)).toBe('ephemeral')

    expect(classifyKind(30000)).toBe('addressable')
    expect(classifyKind(30023)).toBe('addressable') // articolo
    expect(classifyKind(31923)).toBe('addressable') // evento calendario
    expect(classifyKind(39999)).toBe('addressable')
  })

  it("l'auth Blossom e' ephemeral, quindi non viene conservata dai relay", () => {
    // Verifica esplicita perche' e' controintuitivo: 24242 e' un evento
    // Nostr firmato, ma non va mai pubblicato su un relay.
    expect(classifyKind(24242)).toBe('ephemeral')
  })

  it("tratta le fasce non assegnate come regolari, che e l'ipotesi conservativa", () => {
    // 45..999 e >= 40000 non sono coperte da NIP-01: il comportamento del
    // relay non e' garantito, quindi non assumiamo alcuna sostituzione.
    expect(classifyKind(45)).toBe('regular')
    expect(classifyKind(999)).toBe('regular')
    expect(classifyKind(40000)).toBe('regular')
  })

  it('rifiuta i kind non validi', () => {
    expect(() => classifyKind(-1)).toThrow(RangeError)
    expect(() => classifyKind(1.5)).toThrow(RangeError)
  })
})

describe('isReplaceableClass', () => {
  it('riconosce le sole classi per cui la modifica ha senso', () => {
    expect(isReplaceableClass('replaceable')).toBe(true)
    expect(isReplaceableClass('addressable')).toBe(true)
    expect(isReplaceableClass('regular')).toBe(false)
    expect(isReplaceableClass('ephemeral')).toBe(false)
  })
})
