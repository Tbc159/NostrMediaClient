<script setup lang="ts">
/**
 * Riscontro durante la rotazione fra i relay.
 *
 * Con la strategia sequenziale la pubblicazione puo' durare parecchi secondi:
 * senza dire *quale* relay si sta contattando, un'attesa lunga sembra un
 * blocco. Il numero d'ordine conta quanto il nome — dice all'utente che il
 * client sta scorrendo l'elenco e non e' fermo sul primo.
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
