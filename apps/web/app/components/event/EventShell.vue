<script setup lang="ts">
import { toNpub, type NostrEvent } from '@nmc/nostr-core'

/** Intestazione comune a tutte le schede evento: autore, data, kind. */
const props = defineProps<{ evento: NostrEvent; etichetta?: string }>()

const npub = computed(() => {
  try {
    return toNpub(props.evento.pubkey)
  } catch {
    // Pubkey malformata: mostriamo l'esadecimale invece di nascondere l'evento.
    return props.evento.pubkey
  }
})

const quando = computed(() => new Date(props.evento.created_at * 1000))
const relativo = computed(() => tempoRelativo(quando.value))
</script>

<template>
  <article class="superficie rounded-xl border p-4">
    <header class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <code class="text-[var(--testo-tenue)]">{{ npub.slice(0, 16) }}…</code>
      <time :datetime="quando.toISOString()" :title="quando.toLocaleString('it-IT')">
        {{ relativo }}
      </time>
      <BaseBadge v-if="etichetta" class="ml-auto">{{ etichetta }}</BaseBadge>
    </header>
    <slot />
  </article>
</template>
