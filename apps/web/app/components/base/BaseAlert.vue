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
    role=alert for the tones that signal a problem alone: applying it to the
    informative notes too would make the screen reader needlessly noisy.
  -->
  <div
    :role="tono === 'pericolo' || tono === 'avviso' ? 'alert' : undefined"
    class="rounded-lg border px-3.5 py-2.5 text-sm"
    :class="toni[tono]"
  >
    <slot />
  </div>
</template>
