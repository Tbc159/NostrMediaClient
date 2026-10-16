import { describe, expect, it } from 'vitest'

import {
  decryptSecretKey,
  encryptSecretKey,
  isEncryptedSecretKey,
  newSecretKey,
  parsePublicKeyInput,
  parseSecretKeyInput,
  passwordStrength,
  publicKeyFrom,
  plainEventTemplate,
  signWithSecretKey,
  toNpub,
  toNsec,
  wipeSecretKey,
} from '../src/identity/keys.js'

describe('reading the keys the user enters', () => {
  it('accepts nsec and hexadecimal alike, getting the same key', () => {
    const sk = newSecretKey()
    const daNsec = parseSecretKeyInput(toNsec(sk))
    const hex = Buffer.from(sk).toString('hex')
    const daHex = parseSecretKeyInput(hex)
    expect(Buffer.from(daNsec).toString('hex')).toBe(hex)
    expect(Buffer.from(daHex).toString('hex')).toBe(hex)
  })

  it('tolerates spaces around the pasted value', () => {
    const sk = newSecretKey()
    expect(parseSecretKeyInput(`  ${toNsec(sk)}  `)).toEqual(sk)
  })

  it('warns explicitly when a public key arrives in place of the private one', () => {
    const npub = toNpub(publicKeyFrom(newSecretKey()))
    expect(() => parseSecretKeyInput(npub)).toThrow(/chiave pubblica/)
  })

  it('warns when a private key ends up in the public key field', () => {
    // The dangerous case: it has to be flagged loudly, not accepted silently.
    const nsec = toNsec(newSecretKey())
    expect(() => parsePublicKeyInput(nsec)).toThrow(/PRIVATA/)
  })

  it('does not repeat the entered value in the error messages', () => {
    // It would end up in the browser's logs: a leaked key stays leaked.
    const segreto = 'nsec1' + 'q'.repeat(58)
    try {
      parseSecretKeyInput(segreto)
      throw new Error('avrebbe dovuto fallire')
    } catch (e) {
      expect((e as Error).message).not.toContain(segreto)
    }
  })

  it('refuses an unrecognisable format', () => {
    expect(() => parseSecretKeyInput('ciao')).toThrow(/Formato non riconosciuto/)
    expect(() => parseSecretKeyInput('')).toThrow(/mancante/)
  })

  it('accepts npub, nprofile and hexadecimal for the public key', () => {
    const pk = publicKeyFrom(newSecretKey())
    expect(parsePublicKeyInput(toNpub(pk))).toBe(pk)
    expect(parsePublicKeyInput(pk)).toBe(pk)
    expect(parsePublicKeyInput(pk.toUpperCase())).toBe(pk)
  })
})

describe('encryption at rest (NIP-49)', () => {
  it('encrypts and decrypts, returning the original key', () => {
    const sk = newSecretKey()
    // A low logn: what matters here is correctness, not the derivation cost.
    const cifrata = encryptSecretKey(sk, 'password-di-prova', 8)
    expect(isEncryptedSecretKey(cifrata)).toBe(true)
    expect(decryptSecretKey(cifrata, 'password-di-prova')).toEqual(sk)
  })

  it('does not let the key leak into the ciphertext', () => {
    const sk = newSecretKey()
    const cifrata = encryptSecretKey(sk, 'password-di-prova', 8)
    expect(cifrata).not.toContain(Buffer.from(sk).toString('hex'))
  })

  it('does not distinguish the reason for the failure on a wrong password', () => {
    // Saying "wrong password" rather than "corrupted data" would help whoever
    // is guessing: the message stays deliberately the same.
    const cifrata = encryptSecretKey(newSecretKey(), 'giusta', 8)
    expect(() => decryptSecretKey(cifrata, 'sbagliata')).toThrow(/Password errata, oppure/)
    expect(() => decryptSecretKey('ncryptsec1rovinato', 'giusta')).toThrow(
      /Password errata, oppure/,
    )
  })

  it('demands a password', () => {
    expect(() => encryptSecretKey(newSecretKey(), '')).toThrow(/password/)
  })
})

describe('the strength of the password', () => {
  it('classifies without ever blocking', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('corta').score).toBe(0)
    expect(passwordStrength('soltantolettere').score).toBe(1)
    expect(passwordStrength('Password1234').score).toBe(2)
    expect(passwordStrength('Password-lunga-1234!').score).toBe(3)
  })
})

describe('signing', () => {
  it('produces an event with the right id, signature and author', () => {
    const sk = newSecretKey()
    const firmato = signWithSecretKey(
      { kind: 1, content: 'ciao', tags: [], created_at: 1_800_000_000 },
      sk,
    )
    expect(firmato.pubkey).toBe(publicKeyFrom(sk))
    expect(firmato.id).toMatch(/^[0-9a-f]{64}$/)
    expect(firmato.sig).toMatch(/^[0-9a-f]{128}$/)
  })
})

describe('clearing the memory', () => {
  it("zeroes the key's bytes", () => {
    const sk = newSecretKey()
    wipeSecretKey(sk)
    expect(sk.every((b) => b === 0)).toBe(true)
  })
})

describe('plainEventTemplate', () => {
  const template = {
    kind: 1,
    content: 'ciao',
    tags: [
      ['t', 'prova'],
      ['e', 'aa'.repeat(32), '', 'root'],
    ],
    created_at: 1_800_000_000,
  }

  it('makes a template wrapped in a Proxy cloneable', () => {
    // It is the real failure, not a textbook case: NIP-07 extensions pass the
    // event to their own content script with postMessage, which uses the
    // structured clone, and the structured clone refuses Proxies. A template
    // composed in a reactive interface is nearly always inside a Proxy.
    const avvolto = new Proxy(template, {})
    expect(() => structuredClone(avvolto)).toThrow(/clone/i)
    expect(() => structuredClone(plainEventTemplate(avvolto))).not.toThrow()
  })

  it('flattens the tags too, which are nested arrays', () => {
    // Flattening the outer level alone would leave the proxies deeper down,
    // and the structured clone would find them anyway.
    const conTagAvvolti = {
      ...template,
      tags: template.tags.map((t) => new Proxy(t, {})),
    }
    expect(() => structuredClone(conTagAvvolti)).toThrow(/clone/i)
    expect(() => structuredClone(plainEventTemplate(conTagAvvolti))).not.toThrow()
  })

  it("does not alter the template's content", () => {
    expect(plainEventTemplate(template)).toEqual(template)
  })

  it('discards the foreign properties, which the relay would refuse', () => {
    // A Nostr event has exactly four fields before the signature: whatever
    // arrives on top from a reactive store must not end up in the signature.
    const sporco = { ...template, __v_isRef: false, extra: 'roba' }
    expect(Object.keys(plainEventTemplate(sporco)).sort()).toEqual([
      'content',
      'created_at',
      'kind',
      'tags',
    ])
  })
})
