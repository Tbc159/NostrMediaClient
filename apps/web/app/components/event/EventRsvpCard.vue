<script setup lang="ts">
import type { NostrEvent, RsvpParsed } from '@nmc/nostr-core'

/** Kind 31925 — the answer to an invitation. */
const props = defineProps<{ evento: NostrEvent; dati: RsvpParsed }>()

const risposte: Record<
  RsvpParsed['status'],
  { testo: string; tono: 'successo' | 'avviso' | 'neutro' }
> = {
  accepted: { testo: 'parteciperò', tono: 'successo' },
  declined: { testo: 'non parteciperò', tono: 'neutro' },
  tentative: { testo: 'forse', tono: 'avviso' },
}

const risposta = computed(() => risposte[props.dati.status])

/**
 * The RSVP points at a `<kind>:<pubkey>:<d>` coordinate, not at an id: the
 * final identifier is shown, which is the only part a human can read.
 */
const identificatoreEvento = computed(() => props.dati.eventAddress.split(':').slice(2).join(':'))
</script>

<template>
  <EventShell :evento="evento" etichetta="risposta a un invito">
    <div class="flex flex-wrap items-center gap-2">
      <BaseBadge :tono="risposta.tono">{{ risposta.testo }}</BaseBadge>
      <BaseBadge v-if="dati.freebusy">
        {{ dati.freebusy === 'busy' ? 'occupato' : 'libero' }}
      </BaseBadge>
    </div>

    <p class="mt-2 text-sm text-[var(--testo-tenue)]">
      All’evento
      <code class="text-xs">{{ identificatoreEvento }}</code>
    </p>

    <p v-if="dati.note" class="mt-2 whitespace-pre-wrap text-sm">{{ dati.note }}</p>
  </EventShell>
</template>
