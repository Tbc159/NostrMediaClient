<script setup lang="ts">
import type { FileMetadataParsed, NostrEvent } from '@nmc/nostr-core'

/** Kind 1063 — scheda di un file (NIP-94). */
const props = defineProps<{ evento: NostrEvent; dati: FileMetadataParsed }>()

const immagine = computed(() => (props.dati.mime ?? '').startsWith('image/'))

const dimensioneLeggibile = computed(() => {
  const byte = props.dati.size
  if (byte === undefined) return null
  if (byte < 1024) return `${byte} B`
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(1)} kB`
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`
})
</script>

<template>
  <EventShell :evento="evento" etichetta="file">
    <img
      v-if="immagine"
      :src="dati.url"
      :alt="dati.alt ?? ''"
      loading="lazy"
      class="mb-3 w-full rounded-lg border object-cover"
    />

    <p v-if="dati.content" class="mb-2 text-sm">{{ dati.content }}</p>

    <dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--testo-tenue)]">
      <div class="flex gap-1">
        <dt>tipo</dt>
        <dd>{{ dati.mime ?? 'non dichiarato' }}</dd>
      </div>
      <div v-if="dimensioneLeggibile" class="flex gap-1">
        <dt>peso</dt>
        <dd>{{ dimensioneLeggibile }}</dd>
      </div>
      <div v-if="dati.dim" class="flex gap-1">
        <dt>dimensioni</dt>
        <dd>{{ dati.dim }}</dd>
      </div>
      <div v-if="dati.sha256" class="flex gap-1">
        <dt>impronta</dt>
        <dd>
          <code>{{ dati.sha256.slice(0, 12) }}…</code>
        </dd>
      </div>
    </dl>

    <p class="mt-2">
      <a :href="dati.url" target="_blank" rel="noopener noreferrer" class="text-sm underline">
        Apri il file →
      </a>
    </p>
  </EventShell>
</template>
