import { decrypt as nip49Decrypt, encrypt as nip49Encrypt } from 'nostr-tools/nip49'
import { decode, npubEncode, nsecEncode } from 'nostr-tools/nip19'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Gestione delle chiavi.
 *
 * La chiave privata **e'** l'identita': chi la possiede la possiede per sempre.
 * Non esiste reset, revoca o recupero, e nessun relay puo' invalidarla. Da qui
 * le due regole che governano questo modulo:
 *
 *   1. la chiave in chiaro non viene mai serializzata: chi la riceve la tiene
 *      in memoria e la cifra (NIP-49) prima di scriverla da qualche parte;
 *   2. niente accessi a `localStorage` o ad altre API del browser, che
 *      renderebbero il modulo non isomorfico e legherebbero la scelta della
 *      persistenza a questo livello.
 *
 * La persistenza e la sua durata sono decisioni dell'applicazione, non del
 * dominio.
 */

/** Chiave privata: 32 byte grezzi. */
export type SecretKey = Uint8Array

const HEX_64 = /^[0-9a-f]{64}$/i

/** Genera una chiave privata nuova. */
export function newSecretKey(): SecretKey {
  return generateSecretKey()
}

/** Chiave pubblica esadecimale corrispondente a una privata. */
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
 * Interpreta una chiave privata scritta dall'utente.
 *
 * Accetta sia il formato `nsec1…` sia i 64 caratteri esadecimali. I messaggi
 * d'errore evitano di riportare il valore inserito: finirebbe nei log.
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
      'Questa e' +
        "' una chiave pubblica (npub), non una privata. " +
        'Per il solo accesso in lettura usa la modalita' +
        "' apposita.",
    )
  }

  throw new Error('Formato non riconosciuto: attesa una chiave nsec1… o 64 caratteri esadecimali.')
}

/**
 * Interpreta una chiave pubblica scritta dall'utente.
 * Accetta `npub1…`, `nprofile1…` o l'esadecimale.
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

// --- Cifratura a riposo (NIP-49) --------------------------------------------

/** Riconosce una chiave gia' cifrata. */
export function isEncryptedSecretKey(valore: string): boolean {
  return valore.trim().startsWith('ncryptsec1')
}

/**
 * Cifra la chiave privata con una password (NIP-49).
 *
 * `logn` regola il costo di scrypt: piu' alto significa piu' lento da
 * derivare, quindi piu' costoso da attaccare a forza bruta. Il valore 16
 * (~65k iterazioni) e' il compromesso raccomandato dal NIP e resta accettabile
 * anche su un telefono.
 */
export function encryptSecretKey(secret: SecretKey, password: string, logn = 16): string {
  if (!password) throw new Error('Serve una password per cifrare la chiave.')
  return nip49Encrypt(secret, password, logn)
}

/** Decifra una chiave protetta da password. */
export function decryptSecretKey(encrypted: string, password: string): SecretKey {
  try {
    return nip49Decrypt(encrypted.trim(), password)
  } catch {
    // L'errore vero non si propaga: distinguere "password sbagliata" da
    // "dato corrotto" darebbe informazioni utili a chi prova a indovinare.
    throw new Error('Password errata, oppure la chiave salvata e' + "' danneggiata.")
  }
}

/**
 * Robustezza della password, per guidare l'utente senza imporgli nulla.
 *
 * Non e' un cancello: e' un indicatore. Una password debole che protegge una
 * chiave e' comunque meglio della chiave in chiaro, e bloccare l'utente qui lo
 * spingerebbe solo verso soluzioni peggiori.
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

// --- Firma ------------------------------------------------------------------

/**
 * Firma un template con una chiave privata in memoria.
 *
 * Calcola id e firma e restituisce l'evento completo. Usata solo dalla
 * modalita' con chiave locale: con NIP-07 o NIP-46 la firma avviene altrove e
 * la chiave non passa mai di qui.
 */
export function signWithSecretKey(template: EventTemplate, secret: SecretKey): NostrEvent {
  return finalizeEvent(template, secret)
}

/**
 * Sovrascrive con zeri i byte di una chiave privata.
 *
 * Non e' una garanzia: JavaScript puo' averne lasciato copie durante le
 * riallocazioni del garbage collector, e non c'e' modo di raggiungerle. Riduce
 * pero' la finestra in cui la chiave resta leggibile in memoria, e costa nulla.
 */
export function wipeSecretKey(secret: SecretKey): void {
  secret.fill(0)
}
