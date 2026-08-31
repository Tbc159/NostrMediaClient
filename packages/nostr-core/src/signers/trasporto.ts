import { newSecretKey, type SecretKey } from '../identity/keys.js'

/**
 * Chiave e segreto del banco di firma, con la loro forma testuale.
 *
 * Vivono separati dalla chiave dell'identita' perche' sono un'altra cosa: non
 * firmano eventi, indirizzano un canale. Chi li ottenesse potrebbe impersonare
 * *l'indirizzo* del banco — far credere a un richiedente di parlare con te —
 * ma non potrebbe firmare nulla a tuo nome. Vanno pero' conservati fra le
 * sessioni: cambiarli equivale a spostare il banco, e ogni delega gia'
 * concessa smetterebbe di funzionare.
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
    throw new Error('Chiave di trasporto non valida: attesi 64 caratteri esadecimali.')
  }
  const byte = new Uint8Array(32)
  for (let i = 0; i < 32; i++) byte[i] = Number.parseInt(pulito.slice(i * 2, i * 2 + 2), 16)
  return byte
}

/**
 * Segreto dell'indirizzo `bunker://`.
 *
 * E' l'unica cosa che impedisce a chi conosca la chiave di trasporto — che
 * viaggia in chiaro nei filtri dei relay — di presentarsi al banco. Va quindi
 * generato a caso e non ricavato da altro.
 */
export function nuovoSegretoBanco(): string {
  const byte = new Uint8Array(16)
  globalThis.crypto.getRandomValues(byte)
  return [...byte].map((b) => b.toString(16).padStart(2, '0')).join('')
}
