import type { EventTemplate } from './types.js'

/**
 * The `client` tag: who wrote the event.
 *
 * NIP-89 provides for `["client", "<name>"]` on a published event, and
 * clients really do write it — a calendar event received from Plektos carries
 * `["client", "Plektos"]`. It helps readers understand what composed it, and
 * developers know where a malformed event came from.
 *
 * It **overwrites** whatever it finds. That is not discourtesy towards the
 * other client: if we reopen a Plektos event and publish it again, that event
 * was written by this program, and leaving someone else's name would be
 * false. Changing the `client` tag does not rewrite history — the original
 * event stays on the relays with its own id, this is a new event.
 *
 * We use the simple form, without the handler event's `31990:…` coordinate:
 * we do not publish one, and declaring a coordinate that does not exist would
 * be worse than saying nothing.
 */

/** The name this client declares itself with. Hard-wired: not configurable. */
export const NOME_CLIENT = 'NostrMediaClient'

/** The tag name, for whoever has to recognise it without typing it by hand. */
export const TAG_CLIENT = 'client'

/**
 * The same template with exactly one `client` tag, ours.
 *
 * Idempotent and with no effect on the original: it returns a copy.
 */
export function conTagClient(template: EventTemplate): EventTemplate {
  return {
    ...template,
    tags: [...template.tags.filter((t) => t[0] !== TAG_CLIENT), [TAG_CLIENT, NOME_CLIENT]],
  }
}
