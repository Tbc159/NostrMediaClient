import type { Event as NostrEvent, EventTemplate } from 'nostr-tools/pure'
import type { ZodType } from 'zod'

export type { NostrEvent, EventTemplate }

/**
 * An event's class according to NIP-01. It determines whether and how the
 * event can be replaced, and therefore whether the idea of "editing" makes
 * sense for that kind.
 *
 * - `regular`     — immutable. There is no editing: all you can do is ask for
 *                   deletion (kind 5) and publish again, getting a new id.
 * - `replaceable` — the relay keeps only the latest event per (pubkey, kind).
 * - `addressable` — the relay keeps only the latest per (pubkey, kind, `d` tag).
 * - `ephemeral`   — relays do not keep it at all.
 */
export type EventClass = 'regular' | 'replaceable' | 'addressable' | 'ephemeral'

/** The coordinate of an addressable event: `<kind>:<pubkey>:<d>`. */
export type AddressPointer = `${number}:${string}:${string}`

/**
 * The context passed to `build()`. It holds what the kind cannot work out by
 * itself but which does not justify a dependency: who is writing, and when.
 */
export interface BuildContext {
  /** The author's public key, hexadecimal. */
  pubkey: string
  /** Unix timestamp in seconds. Injectable so tests stay deterministic. */
  now: number
}

/** How a kind takes part in chronological feeds. */
export interface FeedBehaviour {
  /** Whether it may appear in a chronological feed. */
  eligible: boolean
  /** Whether it should only be shown when it carries at least one valid `imeta`. */
  requiresMedia?: boolean
}

/**
 * A kind definition: the client's unit of extension.
 *
 * Adding support for a new kind means creating a file in
 * `kinds/definitions/` that exports one of these structures and registering
 * it. No other file in the application has to be touched: rendering goes
 * through `renderer`, feeds through `feed`, validation through `schema`.
 *
 * @typeParam TParsed - the typed shape of the event after parsing.
 * @typeParam TInput  - the application data the event is built from.
 */
export interface KindDefinition<TParsed = unknown, TInput = unknown> {
  /** The kind number, as per the specification. */
  readonly kind: number

  /** A readable name, used in logs and in the debug UI. */
  readonly name: string

  /** The NIP or BUD that defines it, to trace the source (e.g. `NIP-52`). */
  readonly nip: string

  /**
   * The declared class. It is checked against the one derived from the
   * number: a mismatch is a registration error, not an option.
   */
  readonly class: EventClass

  /**
   * Whether the user may edit an already published event.
   * True only for `replaceable` and `addressable`: for the others the
   * protocol offers no editing and the UI must not pretend otherwise.
   */
  readonly editable: boolean

  /** Whether offering a NIP-09 deletion request (kind 5) makes sense. */
  readonly deletable: boolean

  /** Validation schema for the result of `parse()`. */
  readonly schema: ZodType<TParsed>

  /**
   * Extracts the typed shape from a raw event.
   * It must throw if the event is not valid for this kind.
   */
  parse(event: NostrEvent): TParsed

  /** Builds the unsigned template. Signing happens elsewhere. */
  build(input: TInput, ctx: BuildContext): EventTemplate

  /**
   * The value of the `d` tag for addressable events.
   * Mandatory when `class` is `addressable`, forbidden otherwise.
   */
  identifier?(input: TInput): string

  /** Feed participation. Absent means "does not appear in feeds". */
  readonly feed?: FeedBehaviour

  /**
   * The rendering component's key, resolved by `KindRenderer.vue`.
   * Absent means the fallback renderer is used.
   */
  readonly renderer?: string
}

/** A definition with its types erased, so they can be stored uniformly. */
// A registry has to be able to hold definitions with different parameters:
// `any` here is deliberate and confined to this alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyKindDefinition = KindDefinition<any, any>
