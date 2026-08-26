<script setup lang="ts">
/**
 * Pulsante. Rende `<button>` o `<NuxtLink>` a seconda che riceva `to`,
 * cosi' i link restano link: navigabili col tasto destro, apribili in una
 * scheda nuova, e annunciati correttamente dagli screen reader.
 */
withDefaults(
  defineProps<{
    variant?: 'primario' | 'secondario' | 'fantasma' | 'pericolo'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    disabled?: boolean
    loading?: boolean
    to?: string
  }>(),
  { variant: 'secondario', size: 'md', type: 'button', to: undefined },
)

const varianti = {
  primario: 'text-[var(--accento-testo)] bg-[var(--accento)] hover:opacity-90 border-transparent',
  secondario: 'superficie border hover:bg-[var(--sfondo-alt)]',
  fantasma: 'border-transparent hover:bg-[var(--sfondo-alt)]',
  pericolo: 'text-white bg-[var(--pericolo)] hover:opacity-90 border-transparent',
}

const misure = { sm: 'px-2.5 py-1 text-xs gap-1.5', md: 'px-3.5 py-2 text-sm gap-2' }

/*
 * Il componente va risolto qui, non passato come stringa a `:is`.
 * Con `:is="'NuxtLink'"` Vue non lo risolve e genera un elemento <nuxtlink>
 * letterale: un tag sconosciuto al browser, senza href e senza navigazione.
 * Il risultato e' un pulsante che sembra funzionare e invece e' inerte.
 */
const NuxtLinkComponent = resolveComponent('NuxtLink')
</script>

<template>
  <component
    :is="to ? NuxtLinkComponent : 'button'"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : disabled || loading"
    :aria-busy="loading || undefined"
    class="inline-flex items-center justify-center rounded-md border font-medium transition-opacity disabled:pointer-events-none disabled:opacity-50"
    :class="[varianti[variant], misure[size]]"
  >
    <svg
      v-if="loading"
      class="size-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" />
    </svg>
    <slot />
  </component>
</template>
