<script setup lang="ts">
/**
 * Feedback during the rotation among the relays.
 *
 * With the sequential strategy the publication can take several seconds:
 * without saying *which* relay is being contacted, a long wait looks like a
 * freeze. The ordinal counts as much as the name — it tells the user that the
 * client is working through the list and is not stuck on the first one.
 */
defineProps<{
  invio: {
    inCorso: Ref<boolean>
    tentativo: Ref<{ url: string; indice: number; totale: number } | null>
    errore: Ref<string | null>
  }
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <p
      v-if="invio.inCorso.value && invio.tentativo.value"
      class="flex items-center gap-2 text-xs text-[var(--testo-tenue)]"
    >
      <span class="h-2 w-2 animate-pulse rounded-full bg-[var(--accento)]" />
      Provo il relay {{ invio.tentativo.value.indice + 1 }} di {{ invio.tentativo.value.totale }}:
      <code>{{ invio.tentativo.value.url }}</code>
    </p>
    <BaseAlert v-if="invio.errore.value" tono="pericolo">{{ invio.errore.value }}</BaseAlert>
  </div>
</template>
