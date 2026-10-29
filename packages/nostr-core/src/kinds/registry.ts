import { classifyKind, isReplaceableClass } from './classify.js'
import { conTagClient } from './client.js'
import type { AnyKindDefinition, KindDefinition } from './types.js'

/**
 * The registry of supported kinds.
 *
 * It is the client's extension point: a new kind is added by creating its
 * definition and passing it to `registerKinds()`, without touching feeds,
 * rendering or actions.
 */
const registry = new Map<number, AnyKindDefinition>()

/**
 * Checks a definition before accepting it.
 *
 * The checks are about consistencies the compiler cannot enforce and which,
 * if broken, would produce wrong behaviour at runtime instead of errors: a UI
 * offering "edit" on an immutable kind, or an addressable event without a `d`
 * tag, which would overwrite the same author's other events.
 */
function assertValidDefinition(def: AnyKindDefinition): void {
  const where = `kind ${def.kind} (${def.name})`

  const derived = classifyKind(def.kind)
  if (def.class !== derived) {
    throw new Error(
      `${where}: declares class "${def.class}" but NIP-01 derives it as "${derived}". ` +
        `Fix the declaration, not the classifier.`,
    )
  }

  if (def.editable && !isReplaceableClass(def.class)) {
    throw new Error(
      `${where}: editable=true on a "${def.class}" class. The protocol does not ` +
        `allow editing these events: all you can do is ask for deletion (kind 5) ` +
        `and publish again, getting a new id. The UI must not simulate editing.`,
    )
  }

  if (def.class === 'addressable' && typeof def.identifier !== 'function') {
    throw new Error(
      `${where}: addressable events require identifier(), which produces the "d" tag. ` +
        `Without it, every new event would overwrite the same author's previous one.`,
    )
  }

  if (def.class !== 'addressable' && typeof def.identifier === 'function') {
    throw new Error(
      `${where}: identifier() only makes sense for addressable events; here the class is "${def.class}".`,
    )
  }

  if (def.class === 'ephemeral' && def.deletable) {
    throw new Error(
      `${where}: deletable=true on an ephemeral kind. Relays do not keep these ` +
        `events, so there is nothing to delete.`,
    )
  }
}

/** Registers a definition. It fails if the kind is taken or inconsistent. */
export function registerKind(def: AnyKindDefinition): void {
  assertValidDefinition(def)

  const existing = registry.get(def.kind)
  if (existing) {
    throw new Error(
      `kind ${def.kind} is already registered by "${existing.name}", it cannot be assigned to "${def.name}".`,
    )
  }

  registry.set(def.kind, def)
}

/** Registers several definitions at once. */
export function registerKinds(defs: readonly AnyKindDefinition[]): void {
  for (const def of defs) registerKind(def)
}

/**
 * A typed identity: it validates the definition's shape as it is written and
 * preserves its type parameters, which a bare literal would lose.
 *
 * **It is also where every event declares the client that wrote it.** The
 * `client` tag (NIP-89) lives here and not in the individual `build()`
 * functions because every definition passes through here, including the ones
 * produced by a factory, and because the signature covers the tags: adding it
 * afterwards — at publish time — would invalidate the signature. No way of
 * composing an event gets around this point, not even importing the
 * definition directly instead of asking the registry for it.
 *
 * `ephemeral` kinds stay out: Blossom's 24242 and NIP-98's 27235, which are not
 * published events but authorisations inside an HTTP header. NIP-89 says not
 * to mark what is not a publication, and an extra tag in an authentication
 * token is just noise the server has to ignore.
 */
export function defineKind<TParsed, TInput>(
  def: KindDefinition<TParsed, TInput>,
): KindDefinition<TParsed, TInput> {
  if (def.class === 'ephemeral') return def
  return {
    ...def,
    build: (input, ctx) => conTagClient(def.build(input, ctx)),
  }
}

/** The definition registered for a kind, or `undefined` if unknown. */
export function getKindDefinition(kind: number): AnyKindDefinition | undefined {
  return registry.get(kind)
}

/** Whether the client knows how to handle this kind. */
export function isKnownKind(kind: number): boolean {
  return registry.has(kind)
}

/** Every registered definition, ordered by kind number. */
export function allKindDefinitions(): AnyKindDefinition[] {
  return [...registry.values()].sort((a, b) => a.kind - b.kind)
}

/** Kinds that may appear in a chronological feed. */
export function feedEligibleKinds(): number[] {
  return allKindDefinitions()
    .filter((def) => def.feed?.eligible === true)
    .map((def) => def.kind)
}

/**
 * Kinds the client can build **and** that a relay keeps.
 *
 * It is the set of things worth re-reading after publishing them, and
 * therefore the right list for a screen showing "what I have written". It is
 * derived from the registry instead of being written by hand: registering a
 * new kind makes it appear on its own, which is the point of the whole
 * structure.
 *
 * Ephemerals stay out for a precise reason, not out of caution: NIP-01 tells
 * relays **not to keep them**, so querying would always come back empty.
 * Blossom's kind 24242 is the example — it is signed and sent, but inside an
 * HTTP header, and it never reaches a relay.
 */
export function publishableKinds(): number[] {
  return allKindDefinitions()
    .filter((def) => def.class !== 'ephemeral')
    .map((def) => def.kind)
}

/**
 * Empties the registry. Tests need it to start from a clean state; in
 * production registration happens once, at startup.
 */
export function clearRegistry(): void {
  registry.clear()
}
