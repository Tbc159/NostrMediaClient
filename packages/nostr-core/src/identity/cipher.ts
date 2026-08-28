import {
  decrypt as nip44Decrypt,
  encrypt as nip44Encrypt,
  getConversationKey,
} from 'nostr-tools/nip44'

import { publicKeyFrom, type SecretKey } from './keys.js'

/**
 * Cifratura NIP-44 verso se stessi.
 *
 * Serve a NIP-37: una bozza e' un evento non firmato, serializzato e cifrato
 * con la propria chiave, cosi' che stia su un relay senza essere leggibile da
 * chi vi accede. E' la differenza sostanziale con il vecchio kind 30024, che
 * finiva sul relay in chiaro.
 *
 * L'interfaccia e' asincrona anche dove non serve: con NIP-07 la cifratura
 * avviene nell'estensione e passa da una `Promise`, e avere due firme diverse
 * a seconda della modalita' costringerebbe ogni chiamante a distinguerle.
 */
export interface CifrarioNip44 {
  encrypt(plaintext: string): Promise<string>
  decrypt(ciphertext: string): Promise<string>
}

/**
 * Cifrario per la modalita' con chiave locale.
 *
 * La chiave di conversazione si deriva **verso la propria stessa pubkey**: in
 * NIP-44 e' una funzione di una chiave privata e di una pubblica, e usando la
 * propria si ottiene un canale con se stessi. E' esattamente quello che serve
 * qui, perche' il destinatario della bozza e' chi la scrive.
 */
export function selfCipher(secret: SecretKey): CifrarioNip44 {
  // Derivata una volta sola: il calcolo e' costoso e la chiave non cambia
  // finche' la sessione resta aperta.
  const conversazione = getConversationKey(secret, publicKeyFrom(secret))

  return {
    encrypt: (plaintext) => Promise.resolve(nip44Encrypt(plaintext, conversazione)),
    decrypt: (ciphertext) => Promise.resolve(nip44Decrypt(ciphertext, conversazione)),
  }
}
