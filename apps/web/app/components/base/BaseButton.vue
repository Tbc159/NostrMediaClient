<script setup lang="ts">
/**
 * A button. It renders a `<button>` or a `<NuxtLink>` depending on whether it
 * receives `to`, so links stay links: navigable with the right mouse button,
 * openable in a new tab, and announced correctly by screen readers.
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
 * The component has to be resolved here, not passed to `:is` as a string.
 * With `:is="'NuxtLink'"` Vue does not resolve it and generates a literal
 * <nuxtlink> element: a tag unknown to the browser, with no href and no
 * navigation. The result is a button that looks like it works and is inert.
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
