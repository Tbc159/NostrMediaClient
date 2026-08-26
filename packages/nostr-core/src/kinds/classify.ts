import type { EventClass } from './types.js'

/**
 * Deriva la classe di un evento dal numero di kind, secondo le regole di NIP-01.
 *
 * Le fasce non sono contigue: i kind bassi seguono regole a parte, ereditate
 * da prima che le fasce venissero formalizzate. In particolare 0 e 3 sono
 * replaceable pur stando sotto 1000, mentre 1 e 2 sono regolari.
 *
 * Usata dal registry per verificare la classe dichiarata in ogni
 * `KindDefinition`: una discrepanza e' un errore di programmazione.
 */
export function classifyKind(kind: number): EventClass {
  if (!Number.isInteger(kind) || kind < 0) {
    throw new RangeError(`Kind non valido: ${kind}. Deve essere un intero non negativo.`)
  }

  // Eccezioni sotto 1000, elencate esplicitamente da NIP-01.
  if (kind === 0 || kind === 3) return 'replaceable'
  if (kind === 1 || kind === 2) return 'regular'
  if (kind >= 4 && kind < 45) return 'regular'

  if (kind >= 1000 && kind < 10000) return 'regular'
  if (kind >= 10000 && kind < 20000) return 'replaceable'
  if (kind >= 20000 && kind < 30000) return 'ephemeral'
  if (kind >= 30000 && kind < 40000) return 'addressable'

  // Fasce non assegnate: 45..999 e >= 40000. NIP-01 non le copre, quindi il
  // comportamento del relay non e' garantito. Le trattiamo come regolari, che
  // e' l'ipotesi conservativa (nessuna sostituzione implicita).
  return 'regular'
}

/** Se il kind e' sostituibile, e quindi se la "modifica" ha senso. */
export function isReplaceableClass(cls: EventClass): boolean {
  return cls === 'replaceable' || cls === 'addressable'
}
