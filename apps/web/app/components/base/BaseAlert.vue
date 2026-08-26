<script setup lang="ts">
withDefaults(defineProps<{ tono?: 'info' | 'successo' | 'avviso' | 'pericolo' }>(), {
  tono: 'info',
})

const toni = {
  info: 'border-[var(--bordo-forte)] text-[var(--testo-tenue)]',
  successo: 'border-[var(--successo)] text-[var(--successo)]',
  avviso: 'border-[var(--avviso)] text-[var(--avviso)]',
  pericolo: 'border-[var(--pericolo)] text-[var(--pericolo)]',
}
</script>

<template>
  <!--
    role=alert solo per i toni che segnalano un problema: applicarlo anche
    alle note informative renderebbe lo screen reader inutilmente rumoroso.
  -->
  <div
    :role="tono === 'pericolo' || tono === 'avviso' ? 'alert' : undefined"
    class="rounded-lg border px-3.5 py-2.5 text-sm"
    :class="toni[tono]"
  >
    <slot />
  </div>
</template>
