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

describe('lettura delle chiavi inserite dall utente', () => {
  it('accetta indifferentemente nsec ed esadecimale, ottenendo la stessa chiave', () => {
    const sk = newSecretKey()
    const daNsec = parseSecretKeyInput(toNsec(sk))
    const hex = Buffer.from(sk).toString('hex')
    const daHex = parseSecretKeyInput(hex)
    expect(Buffer.from(daNsec).toString('hex')).toBe(hex)
    expect(Buffer.from(daHex).toString('hex')).toBe(hex)
  })

  it('tollera spazi attorno al valore incollato', () => {
    const sk = newSecretKey()
    expect(parseSecretKeyInput(`  ${toNsec(sk)}  `)).toEqual(sk)
  })

  it('avverte in modo esplicito se al posto della privata arriva una pubblica', () => {
    const npub = toNpub(publicKeyFrom(newSecretKey()))
    expect(() => parseSecretKeyInput(npub)).toThrow(/chiave pubblica/)
  })

  it('avverte se nel campo della chiave pubblica finisce una privata', () => {
    // Il caso pericoloso: va segnalato a voce alta, non accettato in silenzio.
    const nsec = toNsec(newSecretKey())
    expect(() => parsePublicKeyInput(nsec)).toThrow(/PRIVATA/)
  })

  it('non riporta il valore inserito nei messaggi d errore', () => {
    // Finirebbe nei log del browser: una chiave trapelata resta trapelata.
    const segreto = 'nsec1' + 'q'.repeat(58)
    try {
      parseSecretKeyInput(segreto)
      throw new Error('avrebbe dovuto fallire')
    } catch (e) {
      expect((e as Error).message).not.toContain(segreto)
    }
  })

  it('rifiuta un formato irriconoscibile', () => {
    expect(() => parseSecretKeyInput('ciao')).toThrow(/Formato non riconosciuto/)
    expect(() => parseSecretKeyInput('')).toThrow(/mancante/)
  })

  it('accetta npub, nprofile ed esadecimale per la chiave pubblica', () => {
    const pk = publicKeyFrom(newSecretKey())
    expect(parsePublicKeyInput(toNpub(pk))).toBe(pk)
    expect(parsePublicKeyInput(pk)).toBe(pk)
    expect(parsePublicKeyInput(pk.toUpperCase())).toBe(pk)
  })
})

describe('cifratura a riposo (NIP-49)', () => {
  it('cifra e decifra restituendo la chiave originale', () => {
    const sk = newSecretKey()
    // logn basso: qui interessa la correttezza, non il costo di derivazione.
    const cifrata = encryptSecretKey(sk, 'password-di-prova', 8)
    expect(isEncryptedSecretKey(cifrata)).toBe(true)
    expect(decryptSecretKey(cifrata, 'password-di-prova')).toEqual(sk)
  })

  it('non lascia trapelare la chiave nel testo cifrato', () => {
    const sk = newSecretKey()
    const cifrata = encryptSecretKey(sk, 'password-di-prova', 8)
    expect(cifrata).not.toContain(Buffer.from(sk).toString('hex'))
  })

  it('con la password sbagliata non distingue il motivo del fallimento', () => {
    // Dire "password errata" invece che "dato corrotto" aiuterebbe chi prova
    // a indovinare: il messaggio resta volutamente unico.
    const cifrata = encryptSecretKey(newSecretKey(), 'giusta', 8)
    expect(() => decryptSecretKey(cifrata, 'sbagliata')).toThrow(/Password errata, oppure/)
    expect(() => decryptSecretKey('ncryptsec1rovinato', 'giusta')).toThrow(
      /Password errata, oppure/,
    )
  })

  it('pretende una password', () => {
    expect(() => encryptSecretKey(newSecretKey(), '')).toThrow(/password/)
  })
})

describe('robustezza della password', () => {
  it('classifica senza mai bloccare', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('corta').score).toBe(0)
    expect(passwordStrength('soltantolettere').score).toBe(1)
    expect(passwordStrength('Password1234').score).toBe(2)
    expect(passwordStrength('Password-lunga-1234!').score).toBe(3)
  })
})

describe('firma', () => {
  it('produce un evento con id, firma e autore corretti', () => {
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

describe('pulizia della memoria', () => {
  it('azzera i byte della chiave', () => {
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

  it('rende clonabile un template avvolto in un Proxy', () => {
    // E' il guasto vero, non un caso di scuola: le estensioni NIP-07 passano
    // l'evento al proprio content script con postMessage, che usa lo
    // structured clone, e lo structured clone rifiuta i Proxy. Un template
    // composto in un'interfaccia reattiva e' quasi sempre dentro un Proxy.
    const avvolto = new Proxy(template, {})
    expect(() => structuredClone(avvolto)).toThrow(/clone/i)
    expect(() => structuredClone(plainEventTemplate(avvolto))).not.toThrow()
  })

  it('appiattisce anche i tag, che sono array annidati', () => {
    // Appiattire solo il livello esterno lascerebbe i proxy piu' in
    // profondita', e lo structured clone li troverebbe comunque.
    const conTagAvvolti = {
      ...template,
      tags: template.tags.map((t) => new Proxy(t, {})),
    }
    expect(() => structuredClone(conTagAvvolti)).toThrow(/clone/i)
    expect(() => structuredClone(plainEventTemplate(conTagAvvolti))).not.toThrow()
  })

  it('non altera il contenuto del template', () => {
    expect(plainEventTemplate(template)).toEqual(template)
  })

  it("scarta le proprieta' estranee, che il relay rifiuterebbe", () => {
    // Un evento Nostr ha esattamente quattro campi prima della firma: quello
    // che arriva in piu' da uno store reattivo non deve finire nella firma.
    const sporco = { ...template, __v_isRef: false, extra: 'roba' }
    expect(Object.keys(plainEventTemplate(sporco)).sort()).toEqual([
      'content',
      'created_at',
      'kind',
      'tags',
    ])
  })
})
