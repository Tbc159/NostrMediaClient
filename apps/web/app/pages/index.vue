<script setup lang="ts">
useHead({ title: 'NostrMediaClient' })

const identita = useIdentity()
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold tracking-tight">Feed</h1>

    <ClientOnly>
      <BaseAlert v-if="!identita.autenticato" tono="info">
        Non hai ancora un’identità configurata.
        <NuxtLink to="/impostazioni" class="underline">Accedi</NuxtLink>
        per firmare quello che componi.
      </BaseAlert>
    </ClientOnly>

    <BaseCard>
      <div class="flex flex-col gap-3 py-6 text-center">
        <p class="text-sm text-[var(--testo-tenue)]">
          Il feed richiede la lettura dai relay, che arriva con il pool di connessioni. Le schermate
          di composizione sono però già utilizzabili: costruiscono e firmano eventi veri.
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <BaseButton to="/scrivi" variant="primario">Scrivi una nota</BaseButton>
          <BaseButton to="/calendario/nuovo">Crea un evento</BaseButton>
          <BaseButton to="/diagnostica" variant="fantasma">Verifica gli endpoint</BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>
</template>
