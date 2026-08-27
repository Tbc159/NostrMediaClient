<script setup lang="ts">
import type { NostrEvent, NoteParsed } from '@nmc/nostr-core'

defineProps<{ evento: NostrEvent; nota: NoteParsed }>()
</script>

<template>
  <EventShell :evento="evento" :etichetta="nota.replyToId ? 'risposta' : undefined">
    <!--
      `whitespace-pre-wrap` conserva gli a capo scritti dall'autore: su Nostr
      il content e' testo semplice, e collassarli cambierebbe come la nota si
      legge. La risoluzione dei link e delle menzioni `nostr:` arriva col
      modulo `content`.
    -->
    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{{ nota.content }}</p>

    <ul v-if="nota.hashtags.length" class="mt-3 flex flex-wrap gap-1.5">
      <li v-for="t in nota.hashtags" :key="t">
        <BaseBadge>#{{ t }}</BaseBadge>
      </li>
    </ul>
  </EventShell>
</template>
