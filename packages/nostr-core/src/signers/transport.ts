import { newSecretKey, type SecretKey } from '../identity/keys.js'

/**
 * The signing desk's key and secret, with their textual form.
 *
 * They live separately from the identity key because they are a different
 * thing: they do not sign events, they address a channel. Whoever obtained
 * them could impersonate the desk's *address* — make a requester believe they
 * are talking to you — but could not sign anything in your name. They do have
 * to be kept across sessions, though: changing them amounts to moving the
 * desk, and every delegation already granted would stop working.
 */

const HEX_64 = /^[0-9a-f]{64}$/i

export function nuovaChiaveTrasporto(): SecretKey {
  return newSecretKey()
}

export function trasportoInTesto(chiave: SecretKey): string {
  return [...chiave].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function trasportoDaTesto(testo: string): SecretKey {
  const pulito = testo.trim()
  if (!HEX_64.test(pulito)) {
    // In Italian like the rest of the interface: this message shows up on the
    // Signatures page when a wrong key is pasted.
    throw new Error('Chiave di trasporto non valida: attesi 64 caratteri esadecimali.')
  }
  const byte = new Uint8Array(32)
  for (let i = 0; i < 32; i++) byte[i] = Number.parseInt(pulito.slice(i * 2, i * 2 + 2), 16)
  return byte
}

/**
 * The secret in the `bunker://` address.
 *
 * It is the only thing stopping whoever knows the transport key — which
 * travels in the clear in the relays' filters — from showing up at the desk.
 * It therefore has to be generated at random and not derived from anything
 * else.
 */
export function nuovoSegretoBanco(): string {
  const byte = new Uint8Array(16)
  globalThis.crypto.getRandomValues(byte)
  return [...byte].map((b) => b.toString(16).padStart(2, '0')).join('')
}
