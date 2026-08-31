<script setup lang="ts">
import type { NostrEvent, PodcastMetadataParsed } from '@nmc/nostr-core'

/**
 * Kind 10154 — descrizione del podcast (NIP-F4).
 *
 * E' la scheda dello *show*, non della persona, anche quando la chiave e' la
 * stessa: i lettori di podcast leggono questa e possono ignorare il kind 0.
 */
defineProps<{ evento: NostrEvent; dati: PodcastMetadataParsed }>()
</script>

<template>
  <EventShell :evento="evento" etichetta="podcast">
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
        <ul v-if="dati.websites.length" class="mt-2 flex flex-wrap gap-2 text-xs">
          <li v-for="w in dati.websites" :key="w">
            <a :href="w" target="_blank" rel="noopener noreferrer" class="underline">{{ w }}</a>
          </li>
        </ul>
      </div>
    </div>
  </EventShell>
</template>
