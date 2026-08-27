<script setup lang="ts">
import type { NostrEvent, PictureParsed } from '@nmc/nostr-core'

/** Kind 20 — le immagini sono il contenuto, non un allegato. */
const props = defineProps<{ evento: NostrEvent; dati: PictureParsed }>()

/** Un avviso di contenuto va rispettato finche' non e' l'utente a toglierlo. */
const scoperto = ref(false)
const coperto = computed(() => props.dati.contentWarning !== undefined && !scoperto.value)

const colonne = computed(() => (props.dati.images.length > 1 ? 'sm:grid-cols-2' : ''))
</script>

<template>
  <EventShell :evento="evento" etichetta="immagini">
    <h3 v-if="dati.title" class="mb-2 text-base font-semibold">{{ dati.title }}</h3>

    <div v-if="coperto" class="flex flex-col items-center gap-2 rounded-lg border p-6 text-center">
      <p class="text-sm text-[var(--testo-tenue)]">
        Contenuto sensibile: {{ dati.contentWarning }}
      </p>
      <BaseButton size="sm" @click="scoperto = true">Mostra comunque</BaseButton>
    </div>

    <div v-else class="grid gap-2" :class="colonne">
      <figure v-for="img in dati.images" :key="img.url" class="flex flex-col gap-1">
        <img
          :src="img.url"
          :alt="img.alt ?? ''"
          loading="lazy"
          class="w-full rounded-lg border object-cover"
        />
        <figcaption v-if="img.alt" class="text-xs text-[var(--testo-tenue)]">
          {{ img.alt }}
        </figcaption>
      </figure>
    </div>

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
