import { getKindDefinition } from '@nmc/nostr-core'

/**
 * A kind's readable name, in the plural, for the filters and the counts.
 *
 * The registry already carries a `name`, but it is a technical identifier in
 * the singular (`post-immagini`, `rsvp-calendario`): fine in the logs, not
 * under a number in the interface. Here is the form that reads, with a
 * fallback on the registry's name for the kinds added in future and not yet
 * translated — so registering a new one makes it appear at once, with the raw
 * label though it may be.
 */
const etichette: Record<number, string> = {
  0: 'profilo',
  1: 'note',
  54: 'episodi podcast',
  20: 'gallerie',
  21: 'video',
  22: 'video corti',
  1063: 'schede file',
  10154: 'descrizione podcast',
  30023: 'articoli',
  30024: 'bozze legacy',
  31922: 'eventi su data',
  31923: 'eventi con orario',
  31925: 'risposte a inviti',
}

export function etichettaKind(kind: number): string {
  return etichette[kind] ?? getKindDefinition(kind)?.name ?? `kind ${kind}`
}

/** The NIP or BUD that defines the kind, to show where it comes from. */
export function nipDelKind(kind: number): string | undefined {
  return getKindDefinition(kind)?.nip
}
