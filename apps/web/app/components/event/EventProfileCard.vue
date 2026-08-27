<script setup lang="ts">
import type { NostrEvent, Profile } from '@nmc/nostr-core'

/**
 * Kind 0 — profilo.
 *
 * Compare fra i propri eventi perche' e' un evento come gli altri: e' stato
 * scritto e pubblicato, e sapere *quando* e su quali relay e' finito serve
 * quanto per una nota. E' replaceable, quindi quello mostrato e' l'ultimo, non
 * la cronologia.
 */
const props = defineProps<{ evento: NostrEvent; dati: Profile }>()

const nome = computed(() => props.dati.display_name || props.dati.name || 'profilo senza nome')

/** Campi valorizzati, per non mostrare righe vuote. */
const campi = computed<[string, string][]>(() => {
  const tutti: [string, string | undefined][] = [
    ['sito', props.dati.website],
    ['NIP-05', props.dati.nip05],
    ['lightning', props.dati.lud16],
  ]
  return tutti.filter((c): c is [string, string] => Boolean(c[1]))
})
</script>

<template>
  <EventShell :evento="evento" etichetta="profilo">
    <div class="flex items-start gap-3">
      <img
        v-if="dati.picture"
        :src="dati.picture"
        alt=""
        loading="lazy"
        class="h-14 w-14 shrink-0 rounded-full border object-cover"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-base font-semibold">{{ nome }}</h3>
        <p v-if="dati.about" class="mt-1 whitespace-pre-wrap text-sm text-[var(--testo-tenue)]">
          {{ dati.about }}
        </p>
        <dl v-if="campi.length" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <div v-for="[etichetta, valore] in campi" :key="etichetta" class="flex gap-1">
            <dt class="text-[var(--testo-tenue)]">{{ etichetta }}</dt>
            <dd class="break-all">{{ valore }}</dd>
          </div>
        </dl>
        <BaseBadge v-if="dati.bot" class="mt-2">dichiarato bot</BaseBadge>
      </div>
    </div>
  </EventShell>
</template>
