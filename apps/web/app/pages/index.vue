<script setup lang="ts">
// Segnaposto della Fase 0. Il feed vero arriva in Fase 3.
useHead({ title: 'NostrMediaClient' })
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 p-8">
    <h1 class="text-2xl font-semibold tracking-tight">NostrMediaClient</h1>
    <p class="text-sm text-neutral-500">
      Scaffolding di Fase 0 attivo. Feed, media e calendario arrivano nelle fasi successive.
    </p>
    <NuxtLink
      to="/diagnostica"
      class="w-fit rounded-md border border-neutral-500/30 px-3 py-1.5 text-sm font-medium hover:bg-neutral-500/10"
    >
      Verifica relay e Blossom →
    </NuxtLink>
  </main>
</template>
