import type { EventClass } from './types.js'

/**
 * Derives an event's class from its kind number, following the NIP-01 rules.
 *
 * The ranges are not contiguous: the low kinds follow rules of their own,
 * inherited from before the ranges were formalised. In particular 0 and 3 are
 * replaceable even though they are below 1000, while 1 and 2 are regular.
 *
 * Used by the registry to check the class declared in every `KindDefinition`:
 * a mismatch is a programming error.
 */
export function classifyKind(kind: number): EventClass {
  if (!Number.isInteger(kind) || kind < 0) {
    throw new RangeError(`Invalid kind: ${kind}. It must be a non-negative integer.`)
  }

  // The exceptions below 1000, listed explicitly by NIP-01.
  if (kind === 0 || kind === 3) return 'replaceable'
  if (kind === 1 || kind === 2) return 'regular'
  if (kind >= 4 && kind < 45) return 'regular'

  if (kind >= 1000 && kind < 10000) return 'regular'
  if (kind >= 10000 && kind < 20000) return 'replaceable'
  if (kind >= 20000 && kind < 30000) return 'ephemeral'
  if (kind >= 30000 && kind < 40000) return 'addressable'

  // Unassigned ranges: 45..999 and >= 40000. NIP-01 does not cover them, so
  // relay behaviour is not guaranteed. We treat them as regular, which is the
  // conservative assumption (no implicit replacement).
  return 'regular'
}

/** Whether the kind is replaceable, and therefore whether "editing" makes sense. */
export function isReplaceableClass(cls: EventClass): boolean {
  return cls === 'replaceable' || cls === 'addressable'
}
