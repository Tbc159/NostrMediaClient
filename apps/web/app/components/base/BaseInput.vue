<script setup lang="ts">
defineProps<{
  id?: string
  type?: string
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  autocomplete?: string
}>()

const modello = defineModel<string>({ default: '' })
</script>

<template>
  <input
    :id="id"
    v-model="modello"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :aria-describedby="describedBy"
    :aria-invalid="invalid || undefined"
    :disabled="disabled"
    :autocomplete="autocomplete"
    class="superficie w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
    :class="invalid && 'border-[var(--pericolo)]'"
  />
</template>
