import {
  decryptSecretKey,
  encryptSecretKey,
  parsePublicKeyInput,
  parseSecretKeyInput,
  plainEventTemplate,
  publicKeyFrom,
  signWithSecretKey,
  toNpub,
  wipeSecretKey,
  type EventTemplate,
  type NostrEvent,
  type SecretKey,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Identita' dell'utente e firma degli eventi.
 *
 * Tre modalita', in ordine di sicurezza decrescente:
 *
 *   - `nip07`     estensione del browser. La chiave non entra mai nel nostro
 *                 codice: le passiamo l'evento e ci torna firmato.
 *   - `readonly`  solo npub. Si legge tutto, non si pubblica nulla.
 *   - `locale`    chiave privata incollata dall'utente. Cifrata NIP-49 prima
 *                 di essere scritta, ma resta la modalita' piu' esposta:
 *                 chiunque acceda al browser e conosca la password possiede
 *                 l'identita' per sempre, senza possibilita' di revoca.
 *
 * REGOLA NON NEGOZIABILE: la chiave decifrata non entra nello stato dello
 * store. Vive in una variabile di modulo, quindi non e' reattiva, non finisce
 * nei devtools e soprattutto non puo' essere serializzata nel payload SSR di
 * Nuxt, che verrebbe scritto in chiaro nell'HTML.
 */

let chiaveInMemoria: SecretKey | null = null

const CHIAVE_STORAGE = 'nmc.identita'

export type ModoAccesso = 'nip07' | 'locale' | 'readonly'

interface IdentitaPersistita {
  modo: ModoAccesso
  pubkey: string
  /** Solo per il modo `locale`: la chiave cifrata NIP-49. Mai quella in chiaro. */
  chiaveCifrata?: string
}

/** Firma esposta dalle estensioni NIP-07 su `window.nostr`. */
interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>
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
    // Storage disabilitato o dato corrotto: si riparte da non autenticati
    // invece di impedire l'avvio dell'applicazione.
    return null
  }
}

function scriviPersistito(dati: IdentitaPersistita | null): void {
  if (!import.meta.client) return
  try {
    if (dati) localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(dati))
    else localStorage.removeItem(CHIAVE_STORAGE)
  } catch {
    // Modalita' privata o quota esaurita: la sessione resta valida in memoria.
  }
}

export const useIdentity = defineStore('identity', () => {
  const modo = ref<ModoAccesso | null>(null)
  const pubkey = ref<string | null>(null)
  /** Solo per il modo locale: c'e' una chiave cifrata da sbloccare. */
  const chiaveCifrata = ref<string | null>(null)
  /** Vero quando la chiave locale e' stata decifrata e si puo' firmare. */
  const sbloccato = ref(false)

  const autenticato = computed(() => pubkey.value !== null)
  const npub = computed(() => (pubkey.value ? toNpub(pubkey.value) : null))

  /** Se in questo stato e' possibile firmare e pubblicare. */
  const puoFirmare = computed(() => {
    if (modo.value === 'nip07') return true
    if (modo.value === 'locale') return sbloccato.value
    return false
  })

  /** Perche' non si puo' firmare, da mostrare in UI. */
  const motivoNonFirmabile = computed(() => {
    if (!autenticato.value) return 'Devi prima accedere.'
    if (modo.value === 'readonly') return 'Sei in sola lettura: non e’ possibile pubblicare.'
    if (modo.value === 'locale' && !sbloccato.value) return 'Sblocca la chiave con la password.'
    return null
  })

  /**
   * Se `window.nostr` c'e'.
   *
   * E' un `ref` e non un `computed` perche' non ha dipendenze reattive: un
   * computed lo calcolerebbe una volta sola, al primo accesso, e resterebbe
   * fermo li'. Le estensioni iniettano `window.nostr` in modo asincrono e
   * possono arrivare **dopo** l'avvio dell'applicazione, lasciando l'utente
   * davanti a un «nessuna estensione rilevata» che una ricarica smentisce.
   */
  const estensioneDisponibile = ref(false)

  /** Ricontrolla la presenza dell'estensione. */
  function rilevaEstensione(): boolean {
    if (!import.meta.client) return false
    estensioneDisponibile.value = typeof window.nostr !== 'undefined'
    return estensioneDisponibile.value
  }

  /** Ricarica lo stato salvato. Da chiamare all'avvio, lato client. */
  function ripristina(): void {
    // Un paio di controlli ravvicinati coprono le estensioni che si iniettano
    // subito dopo il caricamento della pagina.
    if (!rilevaEstensione() && import.meta.client) {
      for (const ritardo of [150, 600, 1500]) setTimeout(rilevaEstensione, ritardo)
    }

    const salvato = leggiPersistito()
    if (!salvato) return
    modo.value = salvato.modo
    pubkey.value = salvato.pubkey
    chiaveCifrata.value = salvato.chiaveCifrata ?? null
    // La chiave locale resta bloccata: la password non si memorizza mai.
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
   * Accesso con chiave privata.
   *
   * La chiave viene cifrata con la password prima di toccare lo storage; la
   * versione in chiaro resta solo in memoria e sparisce a fine sessione.
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

  /** Sblocca una chiave gia' salvata, cifrata. */
  function sblocca(password: string): void {
    if (!chiaveCifrata.value) throw new Error('Nessuna chiave salvata da sbloccare.')
    const sk = decryptSecretKey(chiaveCifrata.value, password)

    // Se la chiave salvata non corrisponde alla pubkey attesa qualcosa non
    // torna: meglio fermarsi che firmare con un'identita' diversa da quella
    // mostrata in interfaccia.
    const pk = publicKeyFrom(sk)
    if (pubkey.value && pk !== pubkey.value) {
      wipeSecretKey(sk)
      throw new Error('La chiave salvata non corrisponde all’identita’ attesa.')
    }

    chiaveInMemoria = sk
    sbloccato.value = true
  }

  /** Richiude la chiave senza uscire dall'account. */
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

  /** Firma un template con la modalita' attiva. */
  async function firma(template: EventTemplate): Promise<NostrEvent> {
    // Il template arriva quasi sempre da un `ref`, e Vue avvolge in un Proxy
    // reattivo qualunque oggetto ci si metta dentro. Va appiattito **prima** di
    // consegnarlo a chi firma: vedi il commento su `plainEventTemplate`.
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
