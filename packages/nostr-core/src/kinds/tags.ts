import type { NostrEvent } from './types.js'

/**
 * Helpers for reading and building an event's tags.
 *
 * A tag is an array of strings whose first element is the name. The shape is
 * deliberately generic in the protocol, so every access has to be careful:
 * `tag[1]` may not exist, and several tags can share the same name. These
 * functions save repeating those checks in every kind.
 */

export type Tag = string[]

/** The first value of the tag with that name, or `undefined`. */
export function tagValue(event: NostrEvent, nome: string): string | undefined {
  const trovato = event.tags.find((t) => t[0] === nome)
  return trovato?.[1]
}

/** Every first value of the tags with that name, dropping the empty ones. */
export function tagValues(event: NostrEvent, nome: string): string[] {
  return event.tags
    .filter((t) => t[0] === nome)
    .map((t) => t[1])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** Whole tags with that name, for when the elements past the first matter too. */
export function tagsNamed(event: NostrEvent, nome: string): Tag[] {
  return event.tags.filter((t) => t[0] === nome)
}

/**
 * The `d` identifier of an addressable event.
 *
 * NIP-01 treats a missing `d` as the empty string, which is still a valid
 * identifier: it must not be confused with "the tag is missing".
 */
export function identifier(event: NostrEvent): string {
  return tagValue(event, 'd') ?? ''
}

/** The `<kind>:<pubkey>:<d>` coordinate of an addressable event. */
export function addressOf(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${identifier(event)}`
}

/**
 * Builds a tag only when there is a value.
 *
 * It keeps events free of empty tags, which some relays refuse and which
 * confuse the clients that read them in any case.
 */
export function optionalTag(nome: string, valore: string | undefined | null): Tag[] {
  const pulito = valore?.trim()
  return pulito ? [[nome, pulito]] : []
}

/** One tag per non-empty value, deduplicated while keeping the order. */
export function repeatedTags(nome: string, valori: readonly string[]): Tag[] {
  const visti = new Set<string>()
  const risultato: Tag[] = []
  for (const v of valori) {
    const pulito = v.trim()
    if (pulito && !visti.has(pulito)) {
      visti.add(pulito)
      risultato.push([nome, pulito])
    }
  }
  return risultato
}

/**
 * Normalises a hashtag for the `t` tag.
 *
 * The widespread convention: lower case and without the leading hash, so that
 * "#Nostr" and "nostr" end up in the same index on the relays.
 */
export function normalizeHashtag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase()
}
