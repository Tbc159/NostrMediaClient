import { catchError, defaultIfEmpty, lastValueFrom, of, timeout, toArray } from 'rxjs'
import type { RelayPool } from 'applesauce-relay'

import { classifyKind } from '../kinds/classify.js'
import { addressOf } from '../kinds/tags.js'
import type { NostrEvent } from '../kinds/types.js'
import { mergeRelayLists } from './pool.js'

/**
 * Lettura di eventi dai relay.
 *
 * Un filtro inviato a piu' relay torna con gli stessi eventi ripetuti e, per
 * gli addressable, con **versioni diverse dello stesso evento**: ogni relay
 * conserva l'ultima che ha visto, e non e' detto che sia la stessa. Ricomporre
 * quel disordine e' il lavoro di questo modulo.
 */

/** Filtro NIP-01, nella forma che serve al client. */
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
  /** Tempo massimo complessivo, in millisecondi. */
  timeoutMs?: number
}

const TIMEOUT_PREDEFINITO = 8_000

/**
 * Interroga i relay e restituisce gli eventi raccolti.
 *
 * Non lancia se i relay non rispondono: restituisce quello che e' arrivato
 * entro la scadenza, anche se vuoto. Un feed che mostra tre note su cinque e'
 * utile; uno che va in errore perche' un relay e' giu' non lo e'.
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
      // Un relay che chiude male non deve far fallire la lettura dagli altri.
      catchError(() => of([] as NostrEvent[])),
      defaultIfEmpty([] as NostrEvent[]),
    ),
  )

  return eventi
}

/** Dal piu' recente al piu' vecchio, con l'id come spareggio deterministico. */
export function ordinaPerData(eventi: readonly NostrEvent[]): NostrEvent[] {
  return [...eventi].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
}

/**
 * Tiene una sola versione per ogni evento sostituibile.
 *
 * Relay diversi possono avere versioni diverse dello stesso evento addressable
 * o replaceable: senza questo passaggio la stessa riunione comparirebbe due
 * volte nel calendario, una col titolo vecchio e una col nuovo.
 *
 * Il criterio e' quello di NIP-01: vince il `created_at` piu' alto e, a parita'
 * di istante, l'id lessicograficamente minore. La regola dello spareggio non e'
 * un dettaglio estetico — e' cio' che fa convergere client diversi sulla stessa
 * versione invece di mostrarne una a testa.
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

/** Lettura, deduplica e ordinamento in un passaggio solo: il caso normale. */
export async function loadTimeline(
  pool: RelayPool,
  relays: readonly string[],
  filtri: Filtro | Filtro[],
  opzioni: OpzioniLettura = {},
): Promise<NostrEvent[]> {
  return ordinaPerData(ultimaVersione(await requestEvents(pool, relays, filtri, opzioni)))
}
