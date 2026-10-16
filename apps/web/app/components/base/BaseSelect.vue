<script setup lang="ts">
/**
 * A native select. Deliberately not a hand-built menu: the native one is
 * accessible already, works from the keyboard and on mobile opens the system
 * picker. Redoing it would bring nothing but regressions.
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
