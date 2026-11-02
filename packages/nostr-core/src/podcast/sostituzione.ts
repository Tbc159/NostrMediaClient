import { podcastEpisodeDefinition, type PodcastEpisodeInput } from '../kinds/definitions/podcast.js'
import { fondiTag, tagAggiuntivi } from '../kinds/preservation.js'
import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Replacing the file of a published episode without the apps noticing a new
 * episode.
 *
 * A kind 54 is a regular event: it cannot be edited, only published again.
 * What the feed service does with two of them is what makes this safe: among
 * the kind 54 with the same `podcast:item:guid` it keeps the newest by
 * `created_at`. So the new event must carry the same GUID and the same date,
 * and every other tag as it was:
 *
 *   - the GUID: the original one if the episode has it (an imported episode);
 *     otherwise the feed used the event's id, which the new event would
 *     change, so the old id becomes the GUID explicitly;
 *   - the date: `published_at` if the episode has it; otherwise the feed used
 *     `created_at`, which the new event would move to now, so it becomes
 *     `published_at`;
 *   - everything else: rebuilt from the parsed event, plus the tags the kind
 *     does not write, kept like in any edit.
 */

export interface FileSostitutivi {
  audio?: { url: string; mime?: string }
  immagine?: string
  /** The new file's length in seconds, when the browser could read it. */
  durata?: number
}

/** The episode's identity in the feed: the GUID the apps know it by. */
export function guidNelFeed(evento: NostrEvent): string {
  return podcastEpisodeDefinition.parse(evento).guidOriginale ?? evento.id
}

/** The date the feed shows for the episode, in seconds. */
export function dataNelFeed(evento: NostrEvent): number {
  return podcastEpisodeDefinition.parse(evento).publishedAt ?? evento.created_at
}

/**
 * The template of the same episode with the new files.
 *
 * @param now the signing time; it must be later than the original's
 *            `created_at`, or the feed service would keep the old one.
 */
export function sostituisciFileEpisodio(
  evento: NostrEvent,
  nuovi: FileSostitutivi,
  now: number,
): EventTemplate {
  if (!nuovi.audio && nuovi.immagine === undefined) {
    throw new Error('Scegli un file da sostituire: l’audio o l’immagine.')
  }
  if (now <= evento.created_at) {
    throw new Error(
      'L’orologio di questo dispositivo è indietro rispetto all’episodio pubblicato: il feed terrebbe la versione vecchia.',
    )
  }
  // The parsed episode is the input that rebuilds it, once the absent fields
  // are dropped rather than set to `undefined`.
  const letto = Object.fromEntries(
    Object.entries(podcastEpisodeDefinition.parse(evento)).filter(([, v]) => v !== undefined),
  ) as unknown as PodcastEpisodeInput
  const ctxOriginale = { pubkey: evento.pubkey, now: evento.created_at }
  const comeEra = podcastEpisodeDefinition.build(letto, ctxOriginale)

  const nuovo = podcastEpisodeDefinition.build(
    {
      ...letto,
      guidOriginale: letto.guidOriginale ?? evento.id,
      publishedAt: letto.publishedAt ?? evento.created_at,
      ...(nuovi.audio ? { audio: [nuovi.audio] } : {}),
      ...(nuovi.immagine !== undefined ? { image: nuovi.immagine } : {}),
      ...(nuovi.durata && nuovi.durata > 0 ? { duration: nuovi.durata } : {}),
    },
    { pubkey: evento.pubkey, now },
  )
  return { ...nuovo, tags: fondiTag(nuovo.tags, tagAggiuntivi(evento, comeEra)) }
}

/**
 * The newest version of every episode, by its GUID in the feed: what the feed
 * shows, and what a list of one's episodes should show too.
 */
export function ultimaVersionePerGuid(eventi: readonly NostrEvent[]): NostrEvent[] {
  const perGuid = new Map<string, NostrEvent>()
  for (const e of eventi) {
    let guid: string
    try {
      guid = guidNelFeed(e)
    } catch {
      continue
    }
    const gia = perGuid.get(guid)
    if (!gia || e.created_at > gia.created_at) perGuid.set(guid, e)
  }
  return [...perGuid.values()].sort((a, b) => dataNelFeed(b) - dataNelFeed(a))
}
