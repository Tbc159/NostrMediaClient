<script setup lang="ts">
import { publishableKinds } from '@nmc/nostr-core'

useHead({ title: 'NostrMediaClient' })

/**
 * Everything this client can publish, in a single list.
 *
 * The set comes from the registry and not from a hand-written list:
 * registering a new kind makes it appear here without touching this page,
 * which is the point of the whole kind structure. The ephemerals stay out,
 * which NIP-01 tells relays not to keep — querying them would always give
 * nothing.
 */
const kinds = publishableKinds()
const LIMITE = 100

const elenco = useEventiPropri(kinds, { limite: LIMITE })

/** `null` means "all": it is a filter, not a forced choice. */
const filtro = ref<number | null>(null)

const conteggi = computed(() => {
  const mappa = new Map<number, number>()
  for (const e of elenco.eventi.value) mappa.set(e.kind, (mappa.get(e.kind) ?? 0) + 1)
  return [...mappa.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
})

const mostrati = computed(() =>
  filtro.value === null
    ? elenco.eventi.value
    : elenco.eventi.value.filter((e) => e.kind === filtro.value),
)

/*
 * The filter works on what has been read already, without going back to the
 * relays: every event is there, and a second query would add waiting in order
 * to show a subset of data that are on the page already.
 */
watch(
  () => elenco.eventi.value,
  () => {
    if (filtro.value !== null && !conteggi.value.some(([k]) => k === filtro.value)) {
      filtro.value = null
    }
  },
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">I tuoi eventi</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">
          Tutto quello che hai pubblicato e che questo client sa interpretare.
        </p>
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
        <BaseButton to="/scrivi" variant="primario">Scrivi</BaseButton>
      </div>
    </div>

    <BaseAlert v-if="elenco.errore.value" tono="pericolo">{{ elenco.errore.value }}</BaseAlert>

    <ClientOnly>
      <SenzaIdentita v-if="elenco.senzaIdentita.value" cosa="gli eventi" />

      <div
        v-else-if="elenco.caricamento.value && !elenco.eventi.value.length"
        class="flex flex-col gap-3"
      >
        <div v-for="n in 3" :key="n" class="superficie h-24 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!elenco.eventi.value.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">
            <template v-if="elenco.ultimaLettura.value">
              Non hai eventi sui relay di lettura. Se hai pubblicato qualcosa, controlla che i relay
              da cui leggi comprendano quelli su cui scrivi: sono due elenchi distinti e possono non
              coincidere.
            </template>
            <template v-else>Lettura dai relay in corso…</template>
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <BaseButton to="/scrivi" variant="primario">Scrivi una nota</BaseButton>
            <BaseButton to="/media/nuovo" variant="fantasma">Carica un media</BaseButton>
            <BaseButton to="/impostazioni" variant="fantasma">Rivedi i relay</BaseButton>
          </div>
        </div>
      </BaseCard>

      <template v-else>
        <nav class="flex flex-wrap gap-2" aria-label="Filtra per tipo di evento">
          <button
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              filtro === null
                ? 'border-transparent bg-[var(--accento)] text-[var(--accento-testo)]'
                : 'superficie hover:bg-[var(--sfondo-alt)]'
            "
            :aria-pressed="filtro === null"
            @click="filtro = null"
          >
            tutti ({{ elenco.eventi.value.length }})
          </button>
          <button
            v-for="[kind, quanti] in conteggi"
            :key="kind"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              filtro === kind
                ? 'border-transparent bg-[var(--accento)] text-[var(--accento-testo)]'
                : 'superficie hover:bg-[var(--sfondo-alt)]'
            "
            :aria-pressed="filtro === kind"
            :title="`kind ${kind} — ${nipDelKind(kind) ?? 'senza NIP dichiarato'}`"
            @click="filtro = kind"
          >
            {{ etichettaKind(kind) }} ({{ quanti }})
          </button>
        </nav>

        <div class="flex flex-col gap-3">
          <EventKindRenderer v-for="e in mostrati" :key="e.id" :evento="e" />
        </div>

        <p class="text-center text-xs text-[var(--testo-tenue)]">
          {{ elenco.eventi.value.length }} eventi da {{ elenco.destinazioni.value.length }} relay,
          su {{ kinds.length }} tipi conosciuti
          <template v-if="elenco.eventi.value.length >= LIMITE">
            — è il tetto richiesto ai relay, non tutto quello che esiste.
          </template>
        </p>
      </template>
    </ClientOnly>
  </div>
</template>
