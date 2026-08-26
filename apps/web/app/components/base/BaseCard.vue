<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>()
</script>

<template>
  <section class="superficie rounded-xl border p-5">
    <header v-if="title || $slots.header" class="mb-4">
      <slot name="header">
        <h2 class="text-base font-semibold">{{ title }}</h2>
        <p v-if="subtitle" class="mt-0.5 text-sm text-[var(--testo-tenue)]">{{ subtitle }}</p>
      </slot>
    </header>
    <slot />
  </section>
</template>
