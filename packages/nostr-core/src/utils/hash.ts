/**
 * Hexadecimal SHA-256, isomorphic.
 *
 * Web Crypto is available both in the browser and in Node since 18, so no
 * per-environment branch is needed — which in this package would be
 * forbidden by the isomorphism rule anyway.
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
