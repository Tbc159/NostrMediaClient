<script setup lang="ts">
import type { NostrEvent } from '@nmc/nostr-core'

/**
 * Ripiego per gli eventi che non sappiamo interpretare.
 *
 * Non e' una schermata d'errore: e' il modo in cui il client resta onesto
 * davanti a un protocollo aperto. L'evento c'e', e' firmato, e mostrarlo per
 * quello che e' vale piu' che nasconderlo.
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
