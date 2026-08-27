<script setup lang="ts">
import { getKindDefinition, type NostrEvent } from '@nmc/nostr-core'

/**
 * Sceglie come mostrare un evento in base al suo kind.
 *
 * Regola del progetto: **il client non si rompe mai davanti a un kind che non
 * conosce**. Nostr e' aperto per costruzione e un relay restituira' sempre
 * cose che non abbiamo previsto; la via d'uscita e' un rendering di ripiego,
 * non un errore. Lo stesso vale per un evento del kind giusto ma malformato:
 * il parse fallisce e si ricade sul grezzo.
 */
const props = defineProps<{ evento: NostrEvent }>()

const definizione = computed(() => getKindDefinition(props.evento.kind))

/** Risultato del parse, oppure il motivo per cui non e' stato possibile. */
const analisi = computed<{ dati: unknown } | { errore: string }>(() => {
  const def = definizione.value
  if (!def) return { errore: `Kind ${props.evento.kind} non supportato da questo client.` }
  try {
    return { dati: def.parse(props.evento) }
  } catch (e) {
    return { errore: e instanceof Error ? e.message : String(e) }
  }
})

const renderer = computed(() => {
  if ('errore' in analisi.value) return 'grezzo'
  return definizione.value?.renderer ?? 'grezzo'
})
</script>

<template>
  <EventNoteCard
    v-if="renderer === 'note'"
    :evento="evento"
    :nota="(analisi as { dati: any }).dati"
  />
  <EventCalendarCard
    v-else-if="renderer === 'calendar-event'"
    :evento="evento"
    :dati="(analisi as { dati: any }).dati"
  />
  <EventRawCard
    v-else
    :evento="evento"
    :motivo="'errore' in analisi ? analisi.errore : undefined"
  />
</template>
