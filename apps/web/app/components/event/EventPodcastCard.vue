<script setup lang="ts">
import type { NostrEvent, PodcastEpisodeParsed } from '@nmc/nostr-core'

/** Kind 54 — episodio di podcast (NIP-F4). */
const props = defineProps<{ evento: NostrEvent; dati: PodcastEpisodeParsed }>()

/**
 * Sorgente da riprodurre: la prima che il browser sa suonare.
 *
 * NIP-F4 ammette piu' tag `audio`, e prendere sempre il primo lascerebbe un
 * lettore vuoto quando l'elenco inizia con un formato non supportato.
 */
const principale = computed(
  () => props.dati.audio.find((a) => !a.mime || a.mime.startsWith('audio/')) ?? props.dati.audio[0],
)
</script>

<template>
  <EventShell :evento="evento" etichetta="episodio podcast">
    <div class="flex gap-3">
      <img
        v-if="dati.image"
        :src="dati.image"
        alt=""
        loading="lazy"
        class="h-20 w-20 shrink-0 rounded-lg border object-cover"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-base font-semibold">{{ dati.title }}</h3>
        <p v-if="dati.description" class="mt-1 text-sm text-[var(--testo-tenue)]">
          {{ dati.description }}
        </p>
      </div>
    </div>

    <audio v-if="principale" :src="principale.url" controls preload="none" class="mt-3 w-full" />

    <p v-if="dati.audio.length > 1" class="mt-1 text-xs text-[var(--testo-tenue)]">
      {{ dati.audio.length }} sorgenti audio dichiarate
    </p>

    <p v-if="dati.content" class="mt-3 whitespace-pre-wrap break-words text-sm">
      {{ dati.content }}
    </p>
  </EventShell>
</template>
