<script setup lang="ts">
import { getKindDefinition, type NostrEvent } from '@nmc/nostr-core'

/**
 * Chooses how to show an event according to its kind.
 *
 * A rule of the project: **the client never breaks in front of a kind it does
 * not know**. Nostr is open by construction and a relay will always return
 * things we have not provided for; the way out is a fallback rendering, not an
 * error. The same holds for an event of the right kind but malformed: the
 * parse fails and we fall back on the raw form.
 */
const props = defineProps<{ evento: NostrEvent }>()

const definizione = computed(() => getKindDefinition(props.evento.kind))

/** The parse's result, or the reason it was not possible. */
const analisi = computed<{ dati: unknown } | { errore: string }>(() => {
  const def = definizione.value
  if (!def) return { errore: `Kind ${props.evento.kind} non supportato da questo client.` }
  try {
    return { dati: def.parse(props.evento) }
  } catch (e) {
    return { errore: e instanceof Error ? e.message : String(e) }
  }
})

const renderer = computed(() => {
  if ('errore' in analisi.value) return 'grezzo'
  return definizione.value?.renderer ?? 'grezzo'
})
</script>

<template>
  <EventNoteCard
    v-if="renderer === 'note'"
    :evento="evento"
    :nota="(analisi as { dati: any }).dati"
  />
  <EventCalendarCard
    v-else-if="renderer === 'calendar-event'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventPictureCard
    v-else-if="renderer === 'picture'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventVideoCard
    v-else-if="renderer === 'video'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventFileCard
    v-else-if="renderer === 'file'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventArticleCard
    v-else-if="renderer === 'article'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventProfileCard
    v-else-if="renderer === 'profile'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventRsvpCard
    v-else-if="renderer === 'calendar-rsvp'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventPodcastCard
    v-else-if="renderer === 'podcast'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventPodcastShowCard
    v-else-if="renderer === 'podcast-show'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventRawCard
    v-else
    :evento="evento"
    :motivo="'errore' in analisi ? analisi.errore : undefined"
  />
</template>
