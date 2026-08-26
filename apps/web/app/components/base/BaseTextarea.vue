<script setup lang="ts">
defineProps<{
  id?: string
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  rows?: number
  disabled?: boolean
}>()

const modello = defineModel<string>({ default: '' })
</script>

<template>
  <textarea
    :id="id"
    v-model="modello"
    :placeholder="placeholder"
    :aria-describedby="describedBy"
    :aria-invalid="invalid || undefined"
    :rows="rows ?? 4"
    :disabled="disabled"
    class="superficie w-full resize-y rounded-md border px-3 py-2 text-sm disabled:opacity-50"
    :class="invalid && 'border-[var(--pericolo)]'"
  />
</template>
