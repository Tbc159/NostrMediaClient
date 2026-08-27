<script setup lang="ts">
useHead({ title: 'NostrMediaClient' })

const LIMITE = 50
const feed = useEventiPropri([1], { limite: LIMITE })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Le tue note</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 1, letti dai relay di lettura.</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          size="sm"
          variant="fantasma"
          :loading="feed.caricamento.value"
          @click="feed.carica()"
        >
          Aggiorna
        </BaseButton>
        <BaseButton to="/scrivi" variant="primario">Scrivi</BaseButton>
      </div>
    </div>

    <BaseAlert v-if="feed.errore.value" tono="pericolo">{{ feed.errore.value }}</BaseAlert>

    <ClientOnly>
      <SenzaIdentita v-if="feed.senzaIdentita.value" cosa="le note" />

      <div
        v-else-if="feed.caricamento.value && !feed.eventi.value.length"
        class="flex flex-col gap-3"
      >
        <div v-for="n in 3" :key="n" class="superficie h-24 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!feed.eventi.value.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">
            <template v-if="feed.ultimaLettura.value">
              Nessuna nota tua sui relay di lettura. Se ne hai pubblicate, controlla che i relay da
              cui leggi comprendano quelli su cui scrivi: sono due elenchi distinti e possono non
              coincidere.
            </template>
            <template v-else>Lettura dai relay in corso…</template>
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <BaseButton to="/scrivi" variant="primario">Scrivi una nota</BaseButton>
            <BaseButton to="/impostazioni" variant="fantasma">Rivedi i relay</BaseButton>
          </div>
        </div>
      </BaseCard>

      <div v-else class="flex flex-col gap-3">
        <EventKindRenderer v-for="e in feed.eventi.value" :key="e.id" :evento="e" />
        <p class="text-center text-xs text-[var(--testo-tenue)]">
          {{ feed.eventi.value.length }} note da {{ feed.destinazioni.value.length }} relay
          <template v-if="feed.eventi.value.length >= LIMITE">
            — è il tetto richiesto ai relay, non tutto quello che esiste.
          </template>
        </p>
      </div>
    </ClientOnly>
  </div>
</template>
