import { getKindDefinition, registerKind } from '../registry.js'
import { articleDefinition, articleDraftDefinition } from './article.js'
import { blossomAuthDefinition } from './blossom-auth.js'
import { calendarDateEventDefinition } from './calendar-date.js'
import { calendarRsvpDefinition } from './calendar-rsvp.js'
import { calendarTimeEventDefinition } from './calendar-time.js'
import { draftWrapDefinition, privateRelaysDefinition } from './draft.js'
import { fileMetadataDefinition } from './file-metadata.js'
import { httpAuthDefinition } from './http-auth.js'
import { metadataDefinition } from './metadata.js'
import { noteDefinition } from './note.js'
import {
  authoredPodcastsDefinition,
  podcastEpisodeDefinition,
  podcastMetadataDefinition,
} from './podcast.js'
import { pictureDefinition } from './picture.js'
import { relayListDefinition } from './relay-list.js'
import { shortVideoDefinition, videoDefinition } from './video.js'

export * from './article.js'
export * from './blossom-auth.js'
export * from './calendar-common.js'
export * from './draft.js'
export * from './calendar-date.js'
export * from './calendar-rsvp.js'
export * from './calendar-time.js'
export * from './file-metadata.js'
export * from './http-auth.js'
export * from './metadata.js'
export * from './note.js'
export * from './podcast.js'
export * from './picture.js'
export * from './relay-list.js'
export * from './video.js'

/** Every known definition. Adding a kind = adding it here. */
export const kindDefinitions = [
  metadataDefinition,
  noteDefinition,
  relayListDefinition,
  pictureDefinition,
  videoDefinition,
  shortVideoDefinition,
  fileMetadataDefinition,
  podcastEpisodeDefinition,
  podcastMetadataDefinition,
  authoredPodcastsDefinition,
  blossomAuthDefinition,
  httpAuthDefinition,
  articleDefinition,
  articleDraftDefinition,
  draftWrapDefinition,
  privateRelaysDefinition,
  calendarDateEventDefinition,
  calendarTimeEventDefinition,
  calendarRsvpDefinition,
] as const

/**
 * Registers the supported kinds.
 *
 * Explicit and not automatic: an import with side effects would make the order
 * of initialisation depend on the order of the imports, which is fragile and
 * hard to test.
 *
 * Idempotent. Calling it again skips the definitions already present, provided
 * they are *the same ones*: the dev server's hot reload runs it several times,
 * and failing there would be noise. A kind taken by a different definition
 * remains an error, though, because that is a real conflict.
 */
export function registerBuiltinKinds(): void {
  for (const def of kindDefinitions) {
    if (getKindDefinition(def.kind) === def) continue
    registerKind(def)
  }
}
