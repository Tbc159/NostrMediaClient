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
/** Every identity used in this browser, the active one included. */
const CHIAVE_SALVATE = 'nmc.identita-salvate'

export type ModoAccesso = 'nip07' | 'locale' | 'readonly'

interface IdentitaPersistita {
  modo: ModoAccesso
  pubkey: string
  /** For the `locale` mode alone: the NIP-49-encrypted key. Never the plain one. */
  chiaveCifrata?: string
}

/**
 * An identity kept in this browser, to switch to without logging in again.
 *
 * Same rule as the active one: a local key is stored encrypted only, and
 * switching to it leaves it locked until its password is given.
 */
export interface IdentitaSalvata extends IdentitaPersistita {
  /** A name to tell them apart: a dedicated key is named after its show. */
  etichetta?: string
}

/** The signer NIP-07 extensions expose on `window.nostr`. */
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

function leggiSalvate(): IdentitaSalvata[] {
  if (!import.meta.client) return []
  try {
    const grezzo = localStorage.getItem(CHIAVE_SALVATE)
    const dati: unknown = grezzo ? JSON.parse(grezzo) : []
    return Array.isArray(dati)
      ? dati.filter(
          (d): d is IdentitaSalvata =>
            typeof d?.pubkey === 'string' && ['nip07', 'locale', 'readonly'].includes(d?.modo),
        )
      : []
  } catch {
    return []
  }
}

function scriviSalvate(salvate: IdentitaSalvata[]): void {
  if (!import.meta.client) return
  try {
    localStorage.setItem(CHIAVE_SALVATE, JSON.stringify(salvate))
  } catch {
    // Storage denied: the list holds for this session.
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
  /** The identities kept in this browser, to switch between. */
  const salvate = ref<IdentitaSalvata[]>([])

  /** Adds an identity to the saved ones, or refreshes it; its label survives. */
  function ricorda(voce: IdentitaSalvata): void {
    const prima = salvate.value.find((s) => s.pubkey === voce.pubkey)
    const etichetta = voce.etichetta ?? prima?.etichetta
    const aggiornata: IdentitaSalvata = { ...voce, ...(etichetta ? { etichetta } : {}) }
    salvate.value = prima
      ? salvate.value.map((s) => (s.pubkey === voce.pubkey ? aggiornata : s))
      : [...salvate.value, aggiornata]
    scriviSalvate(salvate.value)
  }

  /** Activates an identity, closing the previous one's key first. */
  function attiva(voce: IdentitaPersistita, sbloccata: boolean): void {
    blocca()
    modo.value = voce.modo
    pubkey.value = voce.pubkey
    chiaveCifrata.value = voce.chiaveCifrata ?? null
    sbloccato.value = sbloccata
    scriviPersistito({
      modo: voce.modo,
      pubkey: voce.pubkey,
      ...(voce.chiaveCifrata ? { chiaveCifrata: voce.chiaveCifrata } : {}),
    })
  }

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

    salvate.value = leggiSalvate()
    const salvato = leggiPersistito()
    if (!salvato) return
    modo.value = salvato.modo
    pubkey.value = salvato.pubkey
    chiaveCifrata.value = salvato.chiaveCifrata ?? null
    // The local key stays locked: the password is never remembered.
    sbloccato.value = salvato.modo === 'nip07'
    // An identity from before the list existed joins it.
    if (!salvate.value.some((s) => s.pubkey === salvato.pubkey)) ricorda(salvato)
  }

  async function accediConEstensione(): Promise<void> {
    if (!import.meta.client || !window.nostr) {
      throw new Error(
        'Nessuna estensione NIP-07 rilevata. Installane una (Alby, nos2x) e ricarica la pagina.',
      )
    }
    const pk = await window.nostr.getPublicKey()
    attiva({ modo: 'nip07', pubkey: pk }, true)
    ricorda({ modo: 'nip07', pubkey: pk })
  }

  function accediSolaLettura(input: string): void {
    const pk = parsePublicKeyInput(input)
    attiva({ modo: 'readonly', pubkey: pk }, false)
    ricorda({ modo: 'readonly', pubkey: pk })
  }

  /**
   * Logging in with a private key.
   *
   * The key is encrypted with the password before it touches the storage; the
   * plain version stays in memory alone and vanishes at the end of the session.
   */
  function accediConChiave(input: string, password: string, etichetta?: string): void {
    const sk = parseSecretKeyInput(input)
    const cifrata = encryptSecretKey(sk, password)
    const pk = publicKeyFrom(sk)

    attiva({ modo: 'locale', pubkey: pk, chiaveCifrata: cifrata }, true)
    chiaveInMemoria = sk
    ricorda({
      modo: 'locale',
      pubkey: pk,
      chiaveCifrata: cifrata,
      ...(etichetta ? { etichetta } : {}),
    })
  }

  /**
   * Switches to a saved identity.
   *
   * The key in use is closed first: one decrypted key at a time, never two. A
   * local key arrives locked, and an extension has to still be signing as the
   * identity that was saved — extensions switch accounts on their own, and
   * signing as somebody else than the name on screen is what must not happen.
   */
  async function cambiaIdentita(pk: string): Promise<void> {
    const voce = salvate.value.find((s) => s.pubkey === pk)
    if (!voce) throw new Error('Questa identità non è fra quelle salvate in questo browser.')
    if (voce.modo === 'nip07') {
      if (!import.meta.client || !window.nostr) {
        throw new Error('Serve l’estensione con cui avevi fatto accesso: non è disponibile.')
      }
      if ((await window.nostr.getPublicKey()) !== pk) {
        throw new Error(
          'L’estensione ora firma con un’altra chiave: cambia account nell’estensione, poi riprova.',
        )
      }
    }
    attiva(voce, voce.modo === 'nip07')
  }

  /** Forgets a saved identity; forgetting the active one logs out of it. */
  function dimentica(pk: string): void {
    if (pk === pubkey.value) {
      esci()
      return
    }
    salvate.value = salvate.value.filter((s) => s.pubkey !== pk)
    scriviSalvate(salvate.value)
  }

  /** Names a saved identity, e.g. after the show its dedicated key carries. */
  function rinomina(pk: string, etichetta: string): void {
    salvate.value = salvate.value.map((s) => {
      if (s.pubkey !== pk) return s
      const { etichetta: _vecchia, ...resto } = s
      return etichetta.trim() ? { ...resto, etichetta: etichetta.trim() } : resto
    })
    scriviSalvate(salvate.value)
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

  /** Logs out of the active identity and forgets it in this browser; the others stay. */
  function esci(): void {
    const uscente = pubkey.value
    blocca()
    modo.value = null
    pubkey.value = null
    chiaveCifrata.value = null
    scriviPersistito(null)
    salvate.value = salvate.value.filter((s) => s.pubkey !== uscente)
    scriviSalvate(salvate.value)
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
    salvate,
    cambiaIdentita,
    dimentica,
    rinomina,
    sblocca,
    blocca,
    esci,
    firma,
  }
})
