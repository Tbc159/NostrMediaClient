/**
 * Name-based UUIDs (version 5, RFC 9562), isomorphic.
 *
 * A v5 UUID is the SHA-1 of a namespace plus a name, with the version and
 * variant bits forced: the same name always gives the same UUID, which is
 * exactly what an identity derived from an address needs. SHA-1 comes from Web
 * Crypto, like SHA-256 in `hash.ts`, so there is no dependency and no
 * per-environment branch.
 */

/** The Podcasting 2.0 namespace for `podcast:guid`. */
export const NAMESPACE_PODCAST = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6'

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function byteDaUuid(uuid: string): Uint8Array {
  if (!FORMA_UUID.test(uuid)) throw new Error(`UUID non valido: "${uuid}"`)
  const esadecimale = uuid.replace(/-/g, '')
  const byte = new Uint8Array(16)
  for (let i = 0; i < 16; i++) byte[i] = Number.parseInt(esadecimale.slice(i * 2, i * 2 + 2), 16)
  return byte
}

function uuidDaByte(byte: Uint8Array): string {
  const h = [...byte].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** The v5 UUID of `nome` in `namespace`. */
export async function uuidV5(namespace: string, nome: string): Promise<string> {
  const ns = byteDaUuid(namespace)
  const testo = new TextEncoder().encode(nome)
  const dati = new Uint8Array(ns.length + testo.length)
  dati.set(ns)
  dati.set(testo, ns.length)

  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', dati))
  const byte = digest.slice(0, 16)
  // Version 5 in the high nibble of byte 6, the RFC variant in byte 8.
  byte[6] = ((byte[6] as number) & 0x0f) | 0x50
  byte[8] = ((byte[8] as number) & 0x3f) | 0x80
  return uuidDaByte(byte)
}

/** True when the string is a UUID in the canonical textual form. */
export function isUuid(valore: string): boolean {
  return FORMA_UUID.test(valore)
}

/**
 * The `podcast:guid` a feed address gives, as Podcasting 2.0 computes it.
 *
 * The seed is the URL **without the scheme and without trailing slashes**, so
 * `https://` and `http://` give the same identity. It is meant to be computed
 * once, from the feed's first address, and then kept: it is the podcast's
 * identity even when the feed moves, which is why NMC writes it into the 10154
 * instead of recomputing it.
 */
export async function podcastGuidPerUrl(url: string): Promise<string> {
  const seme = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/+$/, '')
  if (seme === '') throw new Error('Serve l’indirizzo del feed per calcolare il podcast:guid.')
  return uuidV5(NAMESPACE_PODCAST, seme)
}
