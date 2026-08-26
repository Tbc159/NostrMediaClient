import { getKindDefinition, registerKind } from '../registry.js'
import { calendarDateEventDefinition } from './calendar-date.js'
import { calendarRsvpDefinition } from './calendar-rsvp.js'
import { calendarTimeEventDefinition } from './calendar-time.js'
import { metadataDefinition } from './metadata.js'
import { noteDefinition } from './note.js'

export * from './calendar-common.js'
export * from './calendar-date.js'
export * from './calendar-rsvp.js'
export * from './calendar-time.js'
export * from './metadata.js'
export * from './note.js'

/** Tutte le definizioni note. Aggiungere un kind = aggiungerlo qui. */
export const kindDefinitions = [
  metadataDefinition,
  noteDefinition,
  calendarDateEventDefinition,
  calendarTimeEventDefinition,
  calendarRsvpDefinition,
] as const

/**
 * Registra i kind supportati.
 *
 * Esplicita e non automatica: un import con effetti collaterali renderebbe
 * l'ordine di inizializzazione dipendente dall'ordine degli import, che e'
 * fragile e difficile da testare.
 *
 * Idempotente. Richiamarla salta le definizioni gia' presenti, purche' siano
 * *le stesse*: l'hot reload del dev server la esegue piu' volte, e fallire li'
 * sarebbe rumore. Un kind occupato da una definizione diversa resta pero' un
 * errore, perche' quello e' un conflitto vero.
 */
export function registerBuiltinKinds(): void {
  for (const def of kindDefinitions) {
    if (getKindDefinition(def.kind) === def) continue
    registerKind(def)
  }
}
