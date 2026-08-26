import type { NostrEvent } from './types.js'

/**
 * Utilita' per leggere e costruire i tag di un evento.
 *
 * Un tag e' un array di stringhe il cui primo elemento e' il nome. La forma e'
 * volutamente generica nel protocollo, quindi ogni accesso va fatto con
 * attenzione: `tag[1]` puo' non esistere, e piu' tag possono avere lo stesso
 * nome. Queste funzioni evitano di ripetere quei controlli in ogni kind.
 */

export type Tag = string[]

/** Primo valore del tag con quel nome, o `undefined`. */
export function tagValue(event: NostrEvent, nome: string): string | undefined {
  const trovato = event.tags.find((t) => t[0] === nome)
  return trovato?.[1]
}

/** Tutti i primi valori dei tag con quel nome, scartando quelli vuoti. */
export function tagValues(event: NostrEvent, nome: string): string[] {
  return event.tags
    .filter((t) => t[0] === nome)
    .map((t) => t[1])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** Tag interi con quel nome, per quando servono anche gli elementi oltre il primo. */
export function tagsNamed(event: NostrEvent, nome: string): Tag[] {
  return event.tags.filter((t) => t[0] === nome)
}

/**
 * Identificatore `d` di un evento addressable.
 *
 * NIP-01 tratta un `d` assente come stringa vuota, che e' comunque un
 * identificatore valido: non va confuso con "manca il tag".
 */
export function identifier(event: NostrEvent): string {
  return tagValue(event, 'd') ?? ''
}

/** Coordinata `<kind>:<pubkey>:<d>` di un evento addressable. */
export function addressOf(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${identifier(event)}`
}

/**
 * Costruisce un tag solo se il valore c'e'.
 *
 * Evita di sporcare gli eventi con tag vuoti, che alcuni relay rifiutano e
 * che comunque confondono i client che li leggono.
 */
export function optionalTag(nome: string, valore: string | undefined | null): Tag[] {
  const pulito = valore?.trim()
  return pulito ? [[nome, pulito]] : []
}

/** Un tag per ciascun valore non vuoto, deduplicati mantenendo l'ordine. */
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
 * Normalizza un hashtag per il tag `t`.
 *
 * Convenzione diffusa: minuscolo e senza il cancelletto iniziale, cosi' che
 * "#Nostr" e "nostr" finiscano nello stesso indice sui relay.
 */
export function normalizeHashtag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase()
}
