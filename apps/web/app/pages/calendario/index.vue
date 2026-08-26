<script setup lang="ts">
useHead({ title: 'Calendario · NostrMediaClient' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Calendario</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Eventi NIP-52.</p>
      </div>
      <BaseButton to="/calendario/nuovo" variant="primario">Nuovo evento</BaseButton>
    </div>

    <BaseCard>
      <div class="flex flex-col items-start gap-3 py-6 text-center sm:items-center">
        <p class="text-sm text-[var(--testo-tenue)]">
          L’elenco degli eventi richiede la lettura dai relay, che arriva con il pool di
          connessioni. Nel frattempo puoi comporre e firmare eventi nuovi.
        </p>
        <BaseButton to="/calendario/nuovo">Componi un evento →</BaseButton>
      </div>
    </BaseCard>

    <div class="grid gap-4 sm:grid-cols-2">
      <BaseCard title="31922 — su data" subtitle="Compleanni, festività, ferie.">
        <p class="text-sm text-[var(--testo-tenue)]">
          Nessun orario e nessun fuso. «Il 3 marzo» resta il 3 marzo ovunque lo si guardi.
        </p>
      </BaseCard>
      <BaseCard title="31923 — con orario" subtitle="Riunioni, concerti, dirette.">
        <p class="text-sm text-[var(--testo-tenue)]">
          Istante assoluto più il fuso in cui va mostrato: un evento alle 09:00 a Tokyo resta alle
          09:00 a Tokyo anche visto da Roma.
        </p>
      </BaseCard>
    </div>
  </div>
</template>
