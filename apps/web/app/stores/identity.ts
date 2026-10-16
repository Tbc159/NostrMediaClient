import {
  decryptSecretKey,
  encryptSecretKey,
  parsePublicKeyInput,
  parseSecretKeyInput,
  plainEventTemplate,
  selfCipher,
  publicKeyFrom,
  signWithSecretKey,
  toNpub,
  wipeSecretKey,
  type CifrarioNip44,
  type EventTemplate,
  type NostrEvent,
  type SecretKey,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * The user's identity and the signing of the events.
 *
 * Three modes, in decreasing order of security:
 *
 *   - `nip07`     a browser extension. The key never enters our code: we pass
 *                 it the event and it comes back signed.
 *   - `readonly`  an npub alone. Everything can be read, nothing published.
 *   - `locale`    a private key pasted by the user. NIP-49-encrypted before
 *                 being written, but it remains the most exposed mode: anyone
 *                 with access to the browser who knows the password holds the
 *                 identity for ever, with no possibility of revocation.
 *
 * A NON-NEGOTIABLE RULE: the decrypted key does not enter the store's state.
 * It lives in a module variable, hence it is not reactive, does not end up in
 * the devtools and above all cannot be serialised into Nuxt's SSR payload,
 * which would be written in the clear into the HTML.
 */

let chiaveInMemoria: SecretKey | null = null

const CHIAVE_STORAGE = 'nmc.identita'

export type ModoAccesso = 'nip07' | 'locale' | 'readonly'

interface IdentitaPersistita {
  modo: ModoAccesso
  pubkey: string
  /** For the `locale` mode alone: the NIP-49-encrypted key. Never the plain one. */
  chiaveCifrata?: string
}

/** Firma esposta dalle estensioni NIP-07 su `window.nostr`. */
interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>
  /**
   * NIP-44 encryption, which NIP-37 uses for the drafts.
   *
   * Optional: not every extension exposes it, and calling it without checking
   * that it is there would produce an unreadable error instead of a message
   * that says what to do.
   */
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

declare global {
  interface Window {
    nostr?: Nip07
  }
}

function leggiPersistito(): IdentitaPersistita | null {
  if (!import.meta.client) return null
  try {
    const grezzo = localStorage.getItem(CHIAVE_STORAGE)
    return grezzo ? (JSON.parse(grezzo) as IdentitaPersistita) : null
  } catch {
    // Storage disabled or data corrupted: we start again unauthenticated
    // instead of preventing the application from starting.
    return null
  }
}

function scriviPersistito(dati: IdentitaPersistita | null): void {
  if (!import.meta.client) return
  try {
    if (dati) localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(dati))
    else localStorage.removeItem(CHIAVE_STORAGE)
  } catch {
    // Private mode or quota exhausted: the session stays valid in memory.
  }
}

export const useIdentity = defineStore('identity', () => {
  const modo = ref<ModoAccesso | null>(null)
  const pubkey = ref<string | null>(null)
  /** For the local mode alone: there is an encrypted key to unlock. */
  const chiaveCifrata = ref<string | null>(null)
  /** True when the local key has been decrypted and signing is possible. */
  const sbloccato = ref(false)

  const autenticato = computed(() => pubkey.value !== null)
  const npub = computed(() => (pubkey.value ? toNpub(pubkey.value) : null))

  /** Whether signing and publishing are possible in this state. */
  const puoFirmare = computed(() => {
    if (modo.value === 'nip07') return true
    if (modo.value === 'locale') return sbloccato.value
    return false
  })

  /** Why signing is not possible, to be shown in the UI. */
  const motivoNonFirmabile = computed(() => {
    if (!autenticato.value) return 'Devi prima accedere.'
    if (modo.value === 'readonly') return 'Sei in sola lettura: non e’ possibile pubblicare.'
    if (modo.value === 'locale' && !sbloccato.value) return 'Sblocca la chiave con la password.'
    return null
  })

  /**
   * Whether `window.nostr` is there.
   *
   * It is a `ref` and not a `computed` because it has no reactive
   * dependencies: a computed would evaluate it once only, on the first access,
   * and would stay stuck there. Extensions inject `window.nostr`
   * asynchronously and can arrive **after** the application has started,
   * leaving the user in front of a «no extension detected» that a reload
   * contradicts.
   */
  const estensioneDisponibile = ref(false)

  /** Checks again whether the extension is there. */
  function rilevaEstensione(): boolean {
    if (!import.meta.client) return false
    estensioneDisponibile.value = typeof window.nostr !== 'undefined'
    return estensioneDisponibile.value
  }

  /** Reloads the saved state. To be called at start-up, on the client side. */
  function ripristina(): void {
    // A couple of checks close together cover the extensions that inject
    // themselves just after the page has loaded.
    if (!rilevaEstensione() && import.meta.client) {
      for (const ritardo of [150, 600, 1500]) setTimeout(rilevaEstensione, ritardo)
    }

    const salvato = leggiPersistito()
    if (!salvato) return
    modo.value = salvato.modo
    pubkey.value = salvato.pubkey
    chiaveCifrata.value = salvato.chiaveCifrata ?? null
    // The local key stays locked: the password is never remembered.
    sbloccato.value = salvato.modo === 'nip07'
  }

  async function accediConEstensione(): Promise<void> {
    if (!import.meta.client || !window.nostr) {
      throw new Error(
        'Nessuna estensione NIP-07 rilevata. Installane una (Alby, nos2x) e ricarica la pagina.',
      )
    }
    const pk = await window.nostr.getPublicKey()
    modo.value = 'nip07'
    pubkey.value = pk
    chiaveCifrata.value = null
    sbloccato.value = true
    scriviPersistito({ modo: 'nip07', pubkey: pk })
  }

  function accediSolaLettura(input: string): void {
    const pk = parsePublicKeyInput(input)
    modo.value = 'readonly'
    pubkey.value = pk
    chiaveCifrata.value = null
    sbloccato.value = false
    scriviPersistito({ modo: 'readonly', pubkey: pk })
  }

  /**
   * Logging in with a private key.
   *
   * The key is encrypted with the password before it touches the storage; the
   * plain version stays in memory alone and vanishes at the end of the session.
   */
  function accediConChiave(input: string, password: string): void {
    const sk = parseSecretKeyInput(input)
    const cifrata = encryptSecretKey(sk, password)
    const pk = publicKeyFrom(sk)

    chiaveInMemoria = sk
    modo.value = 'locale'
    pubkey.value = pk
    chiaveCifrata.value = cifrata
    sbloccato.value = true
    scriviPersistito({ modo: 'locale', pubkey: pk, chiaveCifrata: cifrata })
  }

  /** Unlocks an already saved, encrypted key. */
  function sblocca(password: string): void {
    if (!chiaveCifrata.value) throw new Error('Nessuna chiave salvata da sbloccare.')
    const sk = decryptSecretKey(chiaveCifrata.value, password)

    // When the saved key does not match the expected pubkey something is
    // wrong: better to stop than to sign with an identity other than the one
    // shown in the interface.
    const pk = publicKeyFrom(sk)
    if (pubkey.value && pk !== pubkey.value) {
      wipeSecretKey(sk)
      throw new Error('La chiave salvata non corrisponde all’identita’ attesa.')
    }

    chiaveInMemoria = sk
    sbloccato.value = true
  }

  /** Locks the key again without logging out of the account. */
  function blocca(): void {
    if (chiaveInMemoria) wipeSecretKey(chiaveInMemoria)
    chiaveInMemoria = null
    sbloccato.value = false
  }

  function esci(): void {
    blocca()
    modo.value = null
    pubkey.value = null
    chiaveCifrata.value = null
    scriviPersistito(null)
  }

  /**
   * The NIP-44 cipher to yourself, for the drafts (NIP-37).
   *
   * `null` when it is not available, with three distinct causes the interface
   * has to be able to tell apart: read-only, a locked key, or an extension
   * that does not expose NIP-44. See `motivoNonCifrabile`.
   */
  const cifrario = computed<CifrarioNip44 | null>(() => {
    if (modo.value === 'nip07') {
      if (!import.meta.client || !window.nostr?.nip44 || !pubkey.value) return null
      const nip44 = window.nostr.nip44
      const pk = pubkey.value
      // To yourself: in NIP-44 the conversation key is derived from a private
      // and a public key, and using your own gives you a channel with
      // yourself.
      return {
        encrypt: (testo) => nip44.encrypt(pk, testo),
        decrypt: (cifrato) => nip44.decrypt(pk, cifrato),
      }
    }

    if (modo.value === 'locale' && sbloccato.value && chiaveInMemoria) {
      return selfCipher(chiaveInMemoria)
    }

    return null
  })

  /** Why the encrypted drafts cannot be used, to be shown in the UI. */
  const motivoNonCifrabile = computed(() => {
    if (cifrario.value) return null
    if (!autenticato.value) return 'Devi prima accedere.'
    if (modo.value === 'readonly') {
      return 'Sei in sola lettura: le bozze cifrate richiedono una chiave.'
    }
    if (modo.value === 'locale' && !sbloccato.value) return 'Sblocca la chiave con la password.'
    if (modo.value === 'nip07') {
      return 'La tua estensione non espone la cifratura NIP-44, che serve alle bozze. Le bozze restano salvate in questo browser.'
    }
    return 'Cifratura non disponibile in questa modalita’.'
  })

  /** Signs a template with the active mode. */
  async function firma(template: EventTemplate): Promise<NostrEvent> {
    // The template nearly always comes from a `ref`, and Vue wraps whatever
    // object you put inside one in a reactive Proxy. It has to be flattened
    // **before** being handed to the signer: see the comment on
    // `plainEventTemplate`.
    const piano = plainEventTemplate(template)

    if (modo.value === 'nip07') {
      if (!import.meta.client || !window.nostr) {
        throw new Error('Estensione NIP-07 non piu’ disponibile.')
      }
      return window.nostr.signEvent(piano)
    }

    if (modo.value === 'locale') {
      if (!chiaveInMemoria) throw new Error('Chiave bloccata: sbloccala con la password.')
      return signWithSecretKey(piano, chiaveInMemoria)
    }

    throw new Error(motivoNonFirmabile.value ?? 'Firma non disponibile in questa modalita’.')
  }

  return {
    modo,
    pubkey,
    npub,
    chiaveCifrata,
    sbloccato,
    autenticato,
    puoFirmare,
    motivoNonFirmabile,
    estensioneDisponibile,
    cifrario,
    motivoNonCifrabile,
    rilevaEstensione,
    ripristina,
    accediConEstensione,
    accediConChiave,
    accediSolaLettura,
    sblocca,
    blocca,
    esci,
    firma,
  }
})
