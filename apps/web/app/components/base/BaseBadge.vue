<script setup lang="ts">
defineProps<{ tono?: 'neutro' | 'accento' | 'successo' | 'avviso' }>()

const toni = {
  neutro: 'bg-[var(--sfondo-alt)] text-[var(--testo-tenue)]',
  accento: 'bg-[var(--accento)] text-[var(--accento-testo)]',
  successo: 'bg-[var(--successo)] text-white',
  avviso: 'bg-[var(--avviso)] text-black',
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
    :class="toni[tono ?? 'neutro']"
  >
    <slot />
  </span>
</template>
