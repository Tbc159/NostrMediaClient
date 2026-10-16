<script setup lang="ts">
/**
 * A field's container: label, help, error.
 *
 * It generates an id and connects it to the control through the slot, so the
 * label really points at the field and the error gets announced: they are the
 * two things most often forgotten when writing forms by hand.
 */
const props = defineProps<{
  label: string
  hint?: string
  error?: string
  required?: boolean
}>()

const id = useId()
const hintId = computed(() => (props.hint ? `${id}-hint` : undefined))
const errorId = computed(() => (props.error ? `${id}-error` : undefined))
const describedBy = computed(
  () => [errorId.value, hintId.value].filter(Boolean).join(' ') || undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium">
      {{ label }}
      <span v-if="required" class="text-[var(--pericolo)]" aria-hidden="true">*</span>
    </label>

    <slot :id="id" :described-by="describedBy" :invalid="Boolean(error)" />

    <p v-if="hint && !error" :id="hintId" class="text-xs text-[var(--testo-tenue)]">
      {{ hint }}
    </p>
    <!-- role=alert: the message is read as soon as it appears -->
    <p v-if="error" :id="errorId" role="alert" class="text-xs text-[var(--pericolo)]">
      {{ error }}
    </p>
  </div>
</template>
