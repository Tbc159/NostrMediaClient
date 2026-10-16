import { describe, expect, it } from 'vitest'

import { classifyKind, isReplaceableClass } from '../src/kinds/classify.js'

describe('classifyKind', () => {
  it('treats 0 and 3 as replaceable, although they sit below 1000', () => {
    // They are NIP-01's explicit exceptions: they predate the formalisation of
    // the ranges and do not follow the numeric rule.
    expect(classifyKind(0)).toBe('replaceable') // the profile
    expect(classifyKind(3)).toBe('replaceable') // the follow list
  })

  it('treats 1 and 2 as regular', () => {
    expect(classifyKind(1)).toBe('regular') // a short note
    expect(classifyKind(2)).toBe('regular') // a recommended relay, deprecated
  })

  it('treats the 4..44 range as regular', () => {
    expect(classifyKind(4)).toBe('regular') // a legacy DM
    expect(classifyKind(20)).toBe('regular') // a picture (NIP-68)
    expect(classifyKind(21)).toBe('regular') // video
    expect(classifyKind(22)).toBe('regular') // vertical video
    expect(classifyKind(44)).toBe('regular')
  })

  it("applies NIP-01's numeric ranges", () => {
    expect(classifyKind(1000)).toBe('regular')
    expect(classifyKind(1063)).toBe('regular') // file metadata
    expect(classifyKind(1111)).toBe('regular') // a comment
    expect(classifyKind(9999)).toBe('regular')

    expect(classifyKind(10000)).toBe('replaceable') // a mute list
    expect(classifyKind(10002)).toBe('replaceable') // a relay list, NIP-65
    expect(classifyKind(10063)).toBe('replaceable') // Blossom servers
    expect(classifyKind(19999)).toBe('replaceable')

    expect(classifyKind(20000)).toBe('ephemeral')
    expect(classifyKind(24242)).toBe('ephemeral') // a Blossom auth
    expect(classifyKind(29999)).toBe('ephemeral')

    expect(classifyKind(30000)).toBe('addressable')
    expect(classifyKind(30023)).toBe('addressable') // an article
    expect(classifyKind(31923)).toBe('addressable') // a calendar event
    expect(classifyKind(39999)).toBe('addressable')
  })

  it('makes the Blossom auth ephemeral, so the relays do not keep it', () => {
    // An explicit check, because it is counter-intuitive: 24242 is a signed
    // Nostr event, but it must never be published to a relay.
    expect(classifyKind(24242)).toBe('ephemeral')
  })

  it('treats the unassigned ranges as regular, which is the conservative assumption', () => {
    // 45..999 and >= 40000 are not covered by NIP-01: the relay's behaviour is
    // not guaranteed, so we assume no replacement at all.
    expect(classifyKind(45)).toBe('regular')
    expect(classifyKind(999)).toBe('regular')
    expect(classifyKind(40000)).toBe('regular')
  })

  it('refuses the invalid kinds', () => {
    expect(() => classifyKind(-1)).toThrow(RangeError)
    expect(() => classifyKind(1.5)).toThrow(RangeError)
  })
})

describe('isReplaceableClass', () => {
  it('recognises only the classes editing makes sense for', () => {
    expect(isReplaceableClass('replaceable')).toBe(true)
    expect(isReplaceableClass('addressable')).toBe(true)
    expect(isReplaceableClass('regular')).toBe(false)
    expect(isReplaceableClass('ephemeral')).toBe(false)
  })
})
