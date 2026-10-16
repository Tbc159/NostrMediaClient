import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Delegated signing (NIP-46).
 *
 * The problem it solves: on Nostr an event has **one** `pubkey` and **one**
 * signature, and there is no "author" field separate from the signer. Whoever
 * wants an episode to appear as published by the podcast, and not by
 * themselves, has no alternative: that event has to be signed by the
 * podcast's key.
 *
 * NIP-46 separates the two without handing over the key. Whoever holds it
 * keeps a *signing desk* listening on a relay; whoever wants to publish
 * composes the event and asks for a signature. The key never leaves the
 * holder's device, and every request can be refused.
 */

/** Something that can sign: the local key, the extension, a remote desk. */
export interface Firmatario {
  /** The public key of the identity that will appear on the signed event. */
  pubkey(): Promise<string>
  firma(template: EventTemplate): Promise<NostrEvent>
}

/** A signature request that reached the desk, awaiting judgement. */
export interface RichiestaFirma {
  /** The requester's public key. It is the *session's*, not their Nostr identity. */
  cliente: string
  kind: number
  template: EventTemplate
}
