<script setup lang="ts">
import type { NostrEvent, NoteParsed } from '@nmc/nostr-core'

defineProps<{ evento: NostrEvent; nota: NoteParsed }>()
</script>

<template>
  <EventShell :evento="evento" :etichetta="nota.replyToId ? 'risposta' : undefined">
    <!--
      `whitespace-pre-wrap` keeps the line breaks the author wrote: on Nostr the
      content is plain text, and collapsing them would change how the note
      reads. Resolving the links and the `nostr:` mentions comes with the
      `content` module.
    -->
    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{{ nota.content }}</p>

    <ul v-if="nota.hashtags.length" class="mt-3 flex flex-wrap gap-1.5">
      <li v-for="t in nota.hashtags" :key="t">
        <BaseBadge>#{{ t }}</BaseBadge>
      </li>
    </ul>
  </EventShell>
</template>
