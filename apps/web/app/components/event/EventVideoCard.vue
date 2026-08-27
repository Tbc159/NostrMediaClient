<script setup lang="ts">
import type { NostrEvent, VideoParsed } from '@nmc/nostr-core'

/** Kind 21 e 22 — video (NIP-71). */
const props = defineProps<{ evento: NostrEvent; dati: VideoParsed }>()

/**
 * La variante da riprodurre.
 *
 * NIP-71 elenca risoluzioni diverse dello stesso video: si prende la prima
 * riproducibile dal browser, non la prima in assoluto, altrimenti un HLS in
 * cima all'elenco lascerebbe un player vuoto su Firefox.
 */
const principale = computed(
  () =>
    props.dati.variants.find(
      (v) => (v.mime ?? '').startsWith('video/') && !v.mime?.includes('mpegURL'),
    ) ?? props.dati.variants[0],
)

const anteprima = computed(() => principale.value?.image?.[0] ?? principale.value?.thumb)

const durata = computed(() => {
  const s = principale.value?.duration
  if (s === undefined) return null
  const minuti = Math.floor(s / 60)
  const secondi = Math.round(s % 60)
  return `${minuti}:${String(secondi).padStart(2, '0')}`
})
</script>

<template>
  <EventShell :evento="evento" :etichetta="evento.kind === 22 ? 'video corto' : 'video'">
    <h3 class="mb-2 text-base font-semibold">{{ dati.title }}</h3>

    <video
      v-if="principale"
      :src="principale.url"
      :poster="anteprima"
      controls
      preload="metadata"
      class="w-full rounded-lg border"
      :class="evento.kind === 22 ? 'mx-auto max-w-sm' : ''"
    />

    <p v-if="durata" class="mt-1 text-xs text-[var(--testo-tenue)]">Durata {{ durata }}</p>

    <p v-if="dati.content" class="mt-3 whitespace-pre-wrap break-words text-sm">
      {{ dati.content }}
    </p>

    <ul v-if="dati.hashtags.length" class="mt-3 flex flex-wrap gap-1.5">
      <li v-for="t in dati.hashtags" :key="t">
        <BaseBadge>#{{ t }}</BaseBadge>
      </li>
    </ul>
  </EventShell>
</template>
