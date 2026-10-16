import type { Tag } from './tags.js'
import type { EventTemplate, NostrEvent } from './types.js'

/**
 * Keeping the tags this client cannot write.
 *
 * A replaceable event is edited by publishing it again: you read it from the
 * relays, fill a form, recompose it. The trouble is that **the form becomes
 * the only source**, and everything that has no field disappears. A calendar
 * event written by another client carries `lat`, `lon`, `place_id`, the
 * theme's colours: real data our form knows nothing about, which the first
 * save would lose for good.
 *
 * Here we do not try to understand them. We keep them: whatever we cannot
 * write we publish again as it was, and we show it to the user, who is the
 * only one able to decide whether it still makes sense.
 *
 * **How we tell what is ours.** There is no list of declared tags per kind —
 * that would be a list to keep aligned by hand, and sooner or later it would
 * not be. Instead we look at what the kind writes *for that event*: we
 * rebuild the template from the event we have just read and compare the tag
 * **names**. The ones the kind does not write are extra.
 *
 * **By name, not by whole tag.** If the original has three `p` tags and the
 * kind writes one, the `p` tags belong to the kind: keeping two of them as
 * «extra» would create phantom participants nobody asked for.
 *
 * **The snapshot is taken when the event is opened.** If the comparison were
 * redone on every recomposition, emptying a field — removing the image —
 * would take `image` out of the built tags, and the old `image` would come
 * back as an extra tag, undoing the edit. Computed once when the event opens,
 * the list stays stable and the user can see it.
 */

/** The tag names present in a template. */
function nomi(tags: readonly Tag[]): Set<string> {
  return new Set(tags.map((t) => t[0] ?? ''))
}

/**
 * The original event's tags that the kind does not write.
 *
 * @param originale the event as it stands on the relays
 * @param costruito the template rebuilt **from that event**, unmodified
 */
export function tagAggiuntivi(originale: NostrEvent, costruito: EventTemplate): Tag[] {
  const nostri = nomi(costruito.tags)
  return originale.tags
    .filter((t) => t.length > 0 && !nostri.has(t[0] as string))
    .map((t) => [...t])
}

/** One tag equals another when all of their elements do. */
const stessoTag = (a: Tag, b: Tag): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The built tags plus the kept ones, appended.
 *
 * Exact duplicates are dropped: a tag identical to one the kind already wrote
 * must not be repeated. A tag with the same name but a different value does
 * stay — that is legal in Nostr, and it is the UI's job to warn when it makes
 * no sense.
 */
export function fondiTag(costruiti: readonly Tag[], aggiuntivi: readonly Tag[]): Tag[] {
  const risultato: Tag[] = costruiti.map((t) => [...t])
  for (const t of aggiuntivi) {
    if (t.length === 0 || !t[0]) continue
    if (risultato.some((g) => stessoTag(g, t))) continue
    risultato.push([...t])
  }
  return risultato
}
