<script setup lang="ts">
/**
 * Select nativa. Deliberatamente non un menu costruito a mano: quella nativa
 * e' gia' accessibile, funziona da tastiera e su mobile apre il selettore di
 * sistema. Rifarla porterebbe solo regressioni.
 */
defineProps<{
  id?: string
  options: { value: string; label: string }[]
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
}>()

const modello = defineModel<string>({ default: '' })
</script>

<template>
  <select
    :id="id"
    v-model="modello"
    :aria-describedby="describedBy"
    :aria-invalid="invalid || undefined"
    :disabled="disabled"
    class="superficie w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
    :class="invalid && 'border-[var(--pericolo)]'"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
