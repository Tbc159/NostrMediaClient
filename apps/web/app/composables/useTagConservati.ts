import { tagAggiuntivi, type AnyKindDefinition, type NostrEvent, type Tag } from '@nmc/nostr-core'

/**
 * The tags of a published event that the form cannot write.
 *
 * Reopening an event to edit it means recomposing it from the form, and the
 * form knows only its own fields: all the rest — Plektos's geographic
 * coordinates, the theme's colours, a tag invented by a client we have never
 * seen — would vanish the moment the title is changed. Here they are set
 * aside, and they return in the republished event.
 *
 * **The snapshot is taken once only**, when the event is opened: the template
 * is rebuilt from the data just read and we look at which tag names the kind
 * writes. Recomputing it on every recomposition would let the fields the user
 * has just emptied back in through the window — with the image removed from
 * the form, `image` would no longer be among the built tags and the old value
 * would pass for a «tag to preserve».
 */
export function useTagConservati(nomiDelForm: MaybeRefOrGetter<readonly string[]>) {
  const tags = ref<Tag[]>([])

  /**
   * Takes the snapshot of the event just read.
   *
   * @param input the data the form would produce **with no changes**, that is
   *              the faithful reconstruction of what was read.
   */
  function fotografa(definizione: AnyKindDefinition, evento: NostrEvent, input: unknown): void {
    try {
      const comeEra = definizione.build(input, { pubkey: evento.pubkey, now: evento.created_at })
      tags.value = tagAggiuntivi(evento, comeEra)
    } catch {
      // The reconstruction can fail on an event the kind considers malformed
      // (an end before the start, a non-existent zone): that is precisely the
      // case where preserving counts most, because the user is here to correct
      // it. It falls back on the names the form declares it writes — less
      // precise, but it loses nothing.
      const nostri = new Set(toValue(nomiDelForm))
      tags.value = evento.tags
        .filter((t) => t.length > 0 && !nostri.has(t[0] as string))
        .map((t) => [...t])
    }
  }

  const azzera = (): void => {
    tags.value = []
  }

  return { tags, fotografa, azzera }
}
