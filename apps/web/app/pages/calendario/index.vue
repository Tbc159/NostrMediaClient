<script setup lang="ts">
useHead({ title: 'Calendario · NostrMediaClient' })

const elenco = useEventiPropri([31922, 31923], { limite: 100 })

/** Istante di inizio, per ordinare eventi con e senza orario nella stessa lista. */
function inizio(tags: string[][], kind: number): number {
  const grezzo = tags.find((t) => t[0] === 'start')?.[1]
  if (!grezzo) return 0
  if (kind === 31923) return Number.parseInt(grezzo, 10) || 0
  // Il 31922 non ha orario: si ancora a mezzanotte UTC solo per ordinare.
  return Math.floor(Date.parse(`${grezzo}T00:00:00Z`) / 1000) || 0
}

const adesso = Math.floor(Date.now() / 1000)

/**
 * Ordinati per data dell'evento, non per data di pubblicazione.
 *
 * `useTimeline` ordina per `created_at`, che per un calendario e' la cosa
 * sbagliata: interessa quando l'evento *accade*, non quando e' stato scritto.
 */
const ordinati = computed(() =>
  [...elenco.eventi.value].sort((a, b) => inizio(a.tags, a.kind) - inizio(b.tags, b.kind)),
)

const futuri = computed(() => ordinati.value.filter((e) => inizio(e.tags, e.kind) >= adesso))
const passati = computed(() =>
  ordinati.value.filter((e) => inizio(e.tags, e.kind) < adesso).reverse(),
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">I tuoi eventi</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 31922 e 31923, letti dai relay.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <BaseButton
          size="sm"
          variant="fantasma"
          :loading="elenco.caricamento.value"
          @click="elenco.carica()"
        >
          Aggiorna
        </BaseButton>
        <BaseButton to="/calendario/nuovo" variant="primario">Nuovo evento</BaseButton>
      </div>
    </div>

    <BaseAlert v-if="elenco.errore.value" tono="pericolo">{{ elenco.errore.value }}</BaseAlert>

    <ClientOnly>
      <SenzaIdentita v-if="elenco.senzaIdentita.value" cosa="gli eventi di calendario" />

      <div v-else-if="elenco.caricamento.value && !ordinati.length" class="flex flex-col gap-3">
        <div v-for="n in 2" :key="n" class="superficie h-28 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!ordinati.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">
            Non hai eventi di calendario sui relay di lettura.
          </p>
          <BaseButton to="/calendario/nuovo" variant="primario">Componi un evento</BaseButton>
        </div>
      </BaseCard>

      <template v-else>
        <section v-if="futuri.length" class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-[var(--testo-tenue)]">In programma</h2>
          <EventKindRenderer v-for="e in futuri" :key="e.id" :evento="e" />
        </section>

        <section v-if="passati.length" class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-[var(--testo-tenue)]">Già svolti</h2>
          <EventKindRenderer v-for="e in passati" :key="e.id" :evento="e" />
        </section>
      </template>
    </ClientOnly>

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
