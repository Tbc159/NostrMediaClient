<script setup lang="ts">
/**
 * Contenitore di un campo: etichetta, aiuto, errore.
 *
 * Genera un id e lo collega al controllo tramite lo slot, cosi' l'etichetta
 * punta davvero al campo e l'errore viene annunciato: sono le due cose che si
 * dimenticano piu' spesso scrivendo form a mano.
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
    <!-- role=alert: il messaggio viene letto appena compare -->
    <p v-if="error" :id="errorId" role="alert" class="text-xs text-[var(--pericolo)]">
      {{ error }}
    </p>
  </div>
</template>
