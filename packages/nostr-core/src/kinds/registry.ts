import { classifyKind, isReplaceableClass } from './classify.js'
import type { AnyKindDefinition, KindDefinition } from './types.js'

/**
 * Registry dei kind supportati.
 *
 * E' il punto di estensione del client: un kind nuovo si aggiunge creando la
 * sua definizione e passandola a `registerKinds()`, senza toccare feed,
 * rendering o azioni.
 */
const registry = new Map<number, AnyKindDefinition>()

/**
 * Verifica una definizione prima di accettarla.
 *
 * I controlli riguardano coerenze che il compilatore non puo' imporre e che,
 * se violate, produrrebbero comportamenti sbagliati a runtime invece di errori:
 * una UI che offre "modifica" su un kind immutabile, o un evento addressable
 * senza tag `d` che sovrascriverebbe gli altri eventi dello stesso autore.
 */
function assertValidDefinition(def: AnyKindDefinition): void {
  const where = `kind ${def.kind} (${def.name})`

  const derived = classifyKind(def.kind)
  if (def.class !== derived) {
    throw new Error(
      `${where}: dichiarata classe "${def.class}" ma NIP-01 la deriva come "${derived}". ` +
        `Correggere la dichiarazione, non il classificatore.`,
    )
  }

  if (def.editable && !isReplaceableClass(def.class)) {
    throw new Error(
      `${where}: editable=true su una classe "${def.class}". Il protocollo non ` +
        `permette di modificare questi eventi: si puo' solo chiedere la cancellazione ` +
        `(kind 5) e ripubblicare, ottenendo un id nuovo. La UI non deve simulare la modifica.`,
    )
  }

  if (def.class === 'addressable' && typeof def.identifier !== 'function') {
    throw new Error(
      `${where}: gli eventi addressable richiedono identifier(), che produce il tag "d". ` +
        `Senza, ogni nuovo evento sovrascriverebbe il precedente dello stesso autore.`,
    )
  }

  if (def.class !== 'addressable' && typeof def.identifier === 'function') {
    throw new Error(
      `${where}: identifier() ha senso solo per gli eventi addressable; qui la classe e' "${def.class}".`,
    )
  }

  if (def.class === 'ephemeral' && def.deletable) {
    throw new Error(
      `${where}: deletable=true su un kind ephemeral. I relay non conservano questi ` +
        `eventi, quindi non c'e' nulla da cancellare.`,
    )
  }
}

/** Registra una definizione. Fallisce se il kind e' gia' preso o se e' incoerente. */
export function registerKind(def: AnyKindDefinition): void {
  assertValidDefinition(def)

  const existing = registry.get(def.kind)
  if (existing) {
    throw new Error(
      `kind ${def.kind} gia' registrato da "${existing.name}", non posso assegnarlo a "${def.name}".`,
    )
  }

  registry.set(def.kind, def)
}

/** Registra piu' definizioni in blocco. */
export function registerKinds(defs: readonly AnyKindDefinition[]): void {
  for (const def of defs) registerKind(def)
}

/**
 * Identita' tipizzata: valida la forma della definizione in fase di scrittura
 * e ne preserva i parametri di tipo, che un letterale nudo perderebbe.
 */
export function defineKind<TParsed, TInput>(
  def: KindDefinition<TParsed, TInput>,
): KindDefinition<TParsed, TInput> {
  return def
}

/** Definizione registrata per un kind, o `undefined` se sconosciuto. */
export function getKindDefinition(kind: number): AnyKindDefinition | undefined {
  return registry.get(kind)
}

/** Se il client sa gestire questo kind. */
export function isKnownKind(kind: number): boolean {
  return registry.has(kind)
}

/** Tutte le definizioni registrate, ordinate per numero di kind. */
export function allKindDefinitions(): AnyKindDefinition[] {
  return [...registry.values()].sort((a, b) => a.kind - b.kind)
}

/** Kind che possono comparire in un feed cronologico. */
export function feedEligibleKinds(): number[] {
  return allKindDefinitions()
    .filter((def) => def.feed?.eligible === true)
    .map((def) => def.kind)
}

/**
 * Kind che il client sa costruire **e** che un relay conserva.
 *
 * E' l'insieme di cio' che ha senso rileggere dopo averlo pubblicato, e quindi
 * l'elenco giusto per una schermata che mostra "quello che ho scritto". Si
 * ricava dal registry invece di essere scritto a mano: registrare un kind nuovo
 * lo fa comparire da solo, che e' il punto dell'intera struttura.
 *
 * Gli effimeri restano fuori per una ragione precisa, non per prudenza: NIP-01
 * dice ai relay di **non conservarli**, quindi interrogarli restituirebbe
 * sempre il vuoto. Il kind 24242 di Blossom e' l'esempio — viene firmato e
 * spedito, ma dentro un header HTTP, e su un relay non arriva mai.
 */
export function publishableKinds(): number[] {
  return allKindDefinitions()
    .filter((def) => def.class !== 'ephemeral')
    .map((def) => def.kind)
}

/**
 * Svuota il registry. Serve ai test per partire da uno stato pulito;
 * in produzione la registrazione avviene una volta sola all'avvio.
 */
export function clearRegistry(): void {
  registry.clear()
}
