import { catchError, defaultIfEmpty, lastValueFrom, of, timeout, toArray } from 'rxjs'
import type { RelayPool } from 'applesauce-relay'

import { classifyKind } from '../kinds/classify.js'
import { addressOf } from '../kinds/tags.js'
import type { NostrEvent } from '../kinds/types.js'
import { mergeRelayLists } from './pool.js'

/**
 * Reading events from the relays.
 *
 * A filter sent to several relays comes back with the same events repeated
 * and, for addressables, with **different versions of the same event**: each
 * relay keeps the last one it saw, and they need not be the same. Putting
 * that disorder back together is this module's job.
 */

/** A NIP-01 filter, in the shape the client needs. */
export interface Filtro {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  search?: string
  [tag: `#${string}`]: string[] | undefined
}

export interface OpzioniLettura {
  /** The overall time limit, in milliseconds. */
  timeoutMs?: number
}

const TIMEOUT_PREDEFINITO = 8_000

/**
 * Queries the relays and returns the events collected.
 *
 * It does not throw when relays do not answer: it returns whatever arrived
 * before the deadline, even if that is nothing. A feed showing three notes
 * out of five is useful; one that errors out because a relay is down is not.
 */
export async function requestEvents(
  pool: RelayPool,
  relays: readonly string[],
  filtri: Filtro | Filtro[],
  opzioni: OpzioniLettura = {},
): Promise<NostrEvent[]> {
  const sorgenti = mergeRelayLists(relays)
  if (sorgenti.length === 0) return []

  const limite = opzioni.timeoutMs ?? TIMEOUT_PREDEFINITO

  const eventi = await lastValueFrom(
    pool.request(sorgenti, filtri as never, { timeout: limite }).pipe(
      toArray(),
      timeout({ first: limite, with: () => of([] as NostrEvent[]) }),
      // A relay that closes badly must not make reading from the others fail.
      catchError(() => of([] as NostrEvent[])),
      defaultIfEmpty([] as NostrEvent[]),
    ),
  )

  return eventi
}

/** Newest to oldest, with the id as a deterministic tie-break. */
export function ordinaPerData(eventi: readonly NostrEvent[]): NostrEvent[] {
  return [...eventi].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
}

/**
 * Keeps a single version of every replaceable event.
 *
 * Different relays can hold different versions of the same addressable or
 * replaceable event: without this step the same meeting would appear twice in
 * the calendar, once with the old title and once with the new one.
 *
 * The criterion is NIP-01's: the highest `created_at` wins and, at the same
 * instant, the lexicographically lower id. The tie-break rule is not an
 * aesthetic detail — it is what makes different clients converge on the same
 * version instead of each showing one of their own.
 */
export function ultimaVersione(eventi: readonly NostrEvent[]): NostrEvent[] {
  const migliori = new Map<string, NostrEvent>()

  for (const evento of eventi) {
    const classe = classifyKind(evento.kind)
    const chiave =
      classe === 'addressable' || classe === 'replaceable' ? addressOf(evento) : `id:${evento.id}`

    const attuale = migliori.get(chiave)
    if (attuale === undefined) {
      migliori.set(chiave, evento)
      continue
    }
    if (
      evento.created_at > attuale.created_at ||
      (evento.created_at === attuale.created_at && evento.id < attuale.id)
    ) {
      migliori.set(chiave, evento)
    }
  }

  return [...migliori.values()]
}

/** Reading, deduplication and ordering in one pass: the normal case. */
export async function loadTimeline(
  pool: RelayPool,
  relays: readonly string[],
  filtri: Filtro | Filtro[],
  opzioni: OpzioniLettura = {},
): Promise<NostrEvent[]> {
  return ordinaPerData(ultimaVersione(await requestEvents(pool, relays, filtri, opzioni)))
}

/**
 * Loads **one** replaceable version: the current one.
 *
 * It is what reopening an already published event for editing needs. The
 * filter asks by coordinate — kind, author and `d` tag — because that is an
 * addressable event's identity: the id changes on every rewrite, the
 * coordinate does not.
 *
 * It queries several relays and keeps the most recent version. That is not
 * pedantry: reopening an old version and publishing it again would overwrite
 * the newer one, silently erasing an edit made elsewhere.
 */
export async function loadReplaceable(
  pool: RelayPool,
  relays: readonly string[],
  coordinata: { kind: number; pubkey: string; identifier?: string },
  opzioni: OpzioniLettura = {},
): Promise<NostrEvent | null> {
  const filtro: Filtro = {
    kinds: [coordinata.kind],
    authors: [coordinata.pubkey],
    limit: 20,
  }
  // Pure replaceables (kind 0, 10000-19999) have no `d` tag: filtering on it
  // would find nothing.
  if (coordinata.identifier !== undefined && coordinata.identifier !== '') {
    filtro['#d'] = [coordinata.identifier]
  }

  const trovati = ultimaVersione(await requestEvents(pool, relays, filtro, opzioni))
  return ordinaPerData(trovati)[0] ?? null
}

/** Loads an event from its id. It works for any kind, regular ones included. */
export async function loadEventById(
  pool: RelayPool,
  relays: readonly string[],
  id: string,
  opzioni: OpzioniLettura = {},
): Promise<NostrEvent | null> {
  const trovati = await requestEvents(pool, relays, { ids: [id], limit: 1 }, opzioni)
  return trovati[0] ?? null
}
