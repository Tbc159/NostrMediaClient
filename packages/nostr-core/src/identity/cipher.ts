import {
  decrypt as nip44Decrypt,
  encrypt as nip44Encrypt,
  getConversationKey,
} from 'nostr-tools/nip44'

import { publicKeyFrom, type SecretKey } from './keys.js'

/**
 * NIP-44 encryption towards yourself.
 *
 * NIP-37 needs it: a draft is an unsigned event, serialised and encrypted
 * with your own key, so that it can sit on a relay without being readable by
 * whoever has access to it. That is the substantial difference from the old
 * kind 30024, which ended up on the relay in the clear.
 *
 * The interface is asynchronous even where it need not be: with NIP-07
 * encryption happens inside the extension and goes through a `Promise`, and
 * having two different signatures depending on the mode would force every
 * caller to tell them apart.
 */
export interface CifrarioNip44 {
  encrypt(plaintext: string): Promise<string>
  decrypt(ciphertext: string): Promise<string>
}

/**
 * The cipher for the local-key mode.
 *
 * The conversation key is derived **towards your own pubkey**: in NIP-44 it is
 * a function of a private and a public key, and using your own gives you a
 * channel with yourself. That is exactly what is needed here, because the
 * recipient of the draft is whoever writes it.
 */
export function selfCipher(secret: SecretKey): CifrarioNip44 {
  // Derived once: the computation is expensive and the key does not change
  // while the session stays open.
  const conversazione = getConversationKey(secret, publicKeyFrom(secret))

  return {
    encrypt: (plaintext) => Promise.resolve(nip44Encrypt(plaintext, conversazione)),
    decrypt: (ciphertext) => Promise.resolve(nip44Decrypt(ciphertext, conversazione)),
  }
}
