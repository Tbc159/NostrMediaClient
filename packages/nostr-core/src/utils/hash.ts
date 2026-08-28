/**
 * SHA-256 esadecimale, isomorfico.
 *
 * Web Crypto e' disponibile sia nel browser sia su Node dalla 18, quindi non
 * serve un ramo per ambiente — che in questo pacchetto sarebbe comunque
 * vietato dalla regola di isomorfismo.
 */
export async function sha256Hex(dati: ArrayBuffer | Uint8Array | string): Promise<string> {
  const byte =
    typeof dati === 'string'
      ? new TextEncoder().encode(dati)
      : dati instanceof Uint8Array
        ? dati
        : new Uint8Array(dati)

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    byte.slice().buffer as ArrayBuffer,
  )
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
