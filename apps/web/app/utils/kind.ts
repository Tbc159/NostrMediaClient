import { getKindDefinition } from '@nmc/nostr-core'

/**
 * Nome leggibile di un kind, al plurale, per i filtri e i conteggi.
 *
 * Il registry porta gia' un `name`, ma e' un identificatore tecnico al
 * singolare (`post-immagini`, `rsvp-calendario`): va bene nei log, non sotto a
 * un numero in interfaccia. Qui c'e' la forma che si legge, con il ripiego sul
 * nome del registry per i kind aggiunti in futuro e non ancora tradotti — cosi'
 * registrarne uno nuovo lo fa comparire subito, seppure con l'etichetta grezza.
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

/** NIP o BUD che definisce il kind, per mostrarne la provenienza. */
export function nipDelKind(kind: number): string | undefined {
  return getKindDefinition(kind)?.nip
}
