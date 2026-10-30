import { decrypt as nip49Decrypt, encrypt as nip49Encrypt } from 'nostr-tools/nip49'
import { decode, npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Key handling.
 *
 * The private key **is** the identity: whoever holds it holds it forever.
 * There is no reset, revocation or recovery, and no relay can invalidate it.
 * Hence the two rules that govern this module:
 *
 *   1. the key in the clear is never serialised: whoever receives it keeps it
 *      in memory and encrypts it (NIP-49) before writing it anywhere;
 *   2. no access to `localStorage` or other browser APIs, which would make
 *      the module non-isomorphic and tie the choice of persistence to this
 *      level.
 *
 * Persistence and how long it lasts are decisions for the application, not
 * for the domain.
 *
 * The error messages stay in Italian: they are shown to whoever is typing a
 * key, and the interface is Italian.
 */

/** A private key: 32 raw bytes. */
export type SecretKey = Uint8Array

const HEX_64 = /^[0-9a-f]{64}$/i

/** Generates a new private key. */
export function newSecretKey(): SecretKey {
  return generateSecretKey()
}

/** The hexadecimal public key corresponding to a private one. */
export function publicKeyFrom(secret: SecretKey): string {
  return getPublicKey(secret)
}

export function toNsec(secret: SecretKey): string {
  return nsecEncode(secret)
}

export function toNpub(publicKey: string): string {
  return npubEncode(publicKey)
}

/**
 * Interprets a private key typed by the user.
 *
 * It accepts both the `nsec1…` form and the 64 hexadecimal characters. The
 * error messages avoid repeating the value entered: it would end up in logs.
 */
export function parseSecretKeyInput(input: string): SecretKey {
  const pulito = input.trim()
  if (!pulito) throw new Error('Chiave privata mancante.')

  if (pulito.startsWith('nsec1')) {
    let decodificato
    try {
      decodificato = decode(pulito)
    } catch {
      throw new Error('Chiave nsec non valida: il codice di controllo non torna.')
    }
    if (decodificato.type !== 'nsec') {
      throw new Error(`Atteso un nsec, ricevuto un ${decodificato.type}.`)
    }
    return decodificato.data
  }

  if (HEX_64.test(pulito)) {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number.parseInt(pulito.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }

  if (pulito.startsWith('npub1')) {
    throw new Error(
      'Questa è una chiave pubblica (npub), non una privata. ' +
        'Per il solo accesso in lettura usa la modalità apposita.',
    )
  }

  throw new Error('Formato non riconosciuto: attesa una chiave nsec1… o 64 caratteri esadecimali.')
}

/**
 * Interprets a public key typed by the user.
 * It accepts `npub1…`, `nprofile1…` or the hexadecimal form.
 */
export function parsePublicKeyInput(input: string): string {
  const pulito = input.trim()
  if (!pulito) throw new Error('Chiave pubblica mancante.')

  if (pulito.startsWith('npub1') || pulito.startsWith('nprofile1')) {
    let decodificato
    try {
      decodificato = decode(pulito)
    } catch {
      throw new Error('Chiave non valida: il codice di controllo non torna.')
    }
    if (decodificato.type === 'npub') return decodificato.data
    if (decodificato.type === 'nprofile') return decodificato.data.pubkey
    throw new Error(`Atteso un npub, ricevuto un ${decodificato.type}.`)
  }

  if (HEX_64.test(pulito)) return pulito.toLowerCase()

  if (pulito.startsWith('nsec1')) {
    throw new Error(
      'Questa e' +
        "' una chiave PRIVATA. Non incollarla qui: " +
        'in questo campo serve la chiave pubblica.',
    )
  }

  throw new Error('Formato non riconosciuto: attesa una chiave npub1… o 64 caratteri esadecimali.')
}

// --- Encryption at rest (NIP-49) --------------------------------------------

/** Recognises a key that is already encrypted. */
export function isEncryptedSecretKey(valore: string): boolean {
  return valore.trim().startsWith('ncryptsec1')
}

/**
 * Encrypts the private key with a password (NIP-49).
 *
 * `logn` sets scrypt's cost: higher means slower to derive, and therefore
 * more expensive to brute-force. The value 16 (~65k iterations) is the
 * compromise the NIP recommends and stays acceptable even on a phone.
 */
export function encryptSecretKey(secret: SecretKey, password: string, logn = 16): string {
  if (!password) throw new Error('Serve una password per cifrare la chiave.')
  return nip49Encrypt(secret, password, logn)
}

/** Decrypts a password-protected key. */
export function decryptSecretKey(encrypted: string, password: string): SecretKey {
  try {
    return nip49Decrypt(encrypted.trim(), password)
  } catch {
    // The real error is not propagated: telling "wrong password" from
    // "corrupted data" would give useful information to someone guessing.
    throw new Error('Password errata, oppure la chiave salvata e' + "' danneggiata.")
  }
}

/**
 * Password strength, to guide the user without imposing anything.
 *
 * It is not a gate: it is an indicator. A weak password protecting a key is
 * still better than the key in the clear, and blocking the user here would
 * only push them towards worse solutions.
 *
 * The labels are Italian: they are shown next to the password field.
 */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3
  label: string
  hint?: string
} {
  const lunghezza = password.length
  const varieta = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(password)).length

  if (lunghezza === 0) return { score: 0, label: 'assente' }
  if (lunghezza < 8) {
    return { score: 0, label: 'troppo corta', hint: 'Servono almeno 8 caratteri.' }
  }
  if (lunghezza < 12 || varieta < 2) {
    return {
      score: 1,
      label: 'debole',
      hint: 'Allungala o mescola maiuscole, numeri e simboli.',
    }
  }
  if (lunghezza < 16 || varieta < 3) return { score: 2, label: 'discreta' }
  return { score: 3, label: 'robusta' }
}

// --- Signing ----------------------------------------------------------------

/**
 * A plain copy of a template, with no wrappers.
 *
 * It must be applied **before handing a template to an external signer**, and
 * the reason is anything but theoretical. NIP-07 extensions do not live in
 * the page: the injected code passes the event to its own content script with
 * `window.postMessage`, which copies the object using the **structured
 * clone**. The structured clone refuses `Proxy` objects, with an error that
 * talks about cloning and not about Nostr:
 *
 *     Failed to execute 'postMessage' on 'Window':
 *     #<Object> could not be cloned.        (Chrome)
 *     Proxy object could not be cloned.     (Firefox)
 *
 * A template composed in a reactive interface almost always lives inside a
 * wrapper of that kind — Vue wraps in a proxy any object put in a `ref` — and
 * handing it over as it is makes signing fail *before* the extension sees it,
 * which makes the extension look broken.
 *
 * The rebuild is explicit instead of relying on a framework function: it says
 * exactly what the signer receives, and it does not tie the domain to Vue.
 * The tags are copied one by one because they are nested arrays, and
 * flattening only the outer level would leave proxies deeper down.
 */
export function plainEventTemplate(template: EventTemplate): EventTemplate {
  return {
    kind: template.kind,
    content: template.content,
    created_at: template.created_at,
    tags: template.tags.map((tag) => [...tag]),
  }
}

/**
 * Signs a template with a private key held in memory.
 *
 * It computes the id and the signature and returns the complete event. Used
 * only by the local-key mode: with NIP-07 or NIP-46 signing happens elsewhere
 * and the key never passes through here.
 */
export function signWithSecretKey(template: EventTemplate, secret: SecretKey): NostrEvent {
  return finalizeEvent(template, secret)
}

/**
 * Overwrites a private key's bytes with zeros.
 *
 * It is not a guarantee: JavaScript may have left copies around during
 * garbage-collector reallocations, and there is no way to reach them. It does
 * shorten the window in which the key stays readable in memory, and it costs
 * nothing.
 */
export function wipeSecretKey(secret: SecretKey): void {
  secret.fill(0)
}
