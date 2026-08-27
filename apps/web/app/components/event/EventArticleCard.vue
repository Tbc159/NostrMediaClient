<script setup lang="ts">
import type { ArticleParsed, NostrEvent } from '@nmc/nostr-core'

/** Kind 30023 — articolo long-form. In elenco si mostra l'anteprima, non il testo intero. */
const props = defineProps<{ evento: NostrEvent; dati: ArticleParsed }>()

const bozza = computed(() => props.evento.kind === 30024)

/**
 * Estratto quando manca il sommario.
 *
 * Si toglie la sintassi Markdown piu' rumorosa invece di renderizzarla: qui
 * serve un'idea del contenuto, e mostrare `## Titolo` grezzo sarebbe peggio di
 * mostrare `Titolo`.
 */
const estratto = computed(() => {
  if (props.dati.summary) return props.dati.summary
  return props.dati.content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
})

const pubblicato = computed(() =>
  props.dati.publishedAt ? new Date(props.dati.publishedAt * 1000) : null,
)

/** Vero se l'articolo e' stato modificato dopo la prima pubblicazione. */
const modificato = computed(
  () =>
    props.dati.publishedAt !== undefined && props.evento.created_at > props.dati.publishedAt + 60,
)
</script>

<template>
  <EventShell :evento="evento" :etichetta="bozza ? 'bozza (30024)' : 'articolo'">
    <h3 class="text-base font-semibold">{{ dati.title ?? 'Senza titolo' }}</h3>

    <img
      v-if="dati.image"
      :src="dati.image"
      alt=""
      loading="lazy"
      class="mt-2 max-h-48 w-full rounded-lg border object-cover"
    />

    <p class="mt-2 text-sm text-[var(--testo-tenue)]">{{ estratto }}</p>

    <p class="mt-2 text-xs text-[var(--testo-tenue)]">
      <template v-if="pubblicato">
        pubblicato il {{ pubblicato.toLocaleDateString('it-IT') }}
      </template>
      <template v-if="modificato">· modificato dopo</template>
      · identificatore
      <code>{{ dati.identifier }}</code>
    </p>

    <ul v-if="dati.hashtags.length" class="mt-3 flex flex-wrap gap-1.5">
      <li v-for="t in dati.hashtags" :key="t">
        <BaseBadge>#{{ t }}</BaseBadge>
      </li>
    </ul>
  </EventShell>
</template>
