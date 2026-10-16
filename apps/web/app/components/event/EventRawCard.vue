<script setup lang="ts">
import type { NostrEvent } from '@nmc/nostr-core'

/**
 * The fallback for the events we cannot interpret.
 *
 * It is not an error screen: it is how the client stays honest in front of an
 * open protocol. The event is there, it is signed, and showing it for what it
 * is counts for more than hiding it.
 */
defineProps<{ evento: NostrEvent; motivo?: string }>()
</script>

<template>
  <EventShell :evento="evento" :etichetta="`kind ${evento.kind}`">
    <p v-if="motivo" class="mb-2 text-xs text-[var(--testo-tenue)]">{{ motivo }}</p>
    <p v-if="evento.content" class="whitespace-pre-wrap break-words text-sm">
      {{ evento.content.slice(0, 500) }}
    </p>
    <details class="mt-2">
      <summary class="cursor-pointer text-xs text-[var(--testo-tenue)]">tag dell’evento</summary>
      <pre class="mt-2 max-h-48 overflow-auto text-xs">{{
        JSON.stringify(evento.tags, null, 2)
      }}</pre>
    </details>
  </EventShell>
</template>
