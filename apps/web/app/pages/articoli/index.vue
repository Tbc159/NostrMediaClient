<script setup lang="ts">
useHead({ title: 'Articoli · NostrMediaClient' })

/**
 * Si leggono anche i 30024: NIP-23 li dichiara deprecati, ma chi ha usato
 * altri client ne ha, e non mostrarli significherebbe far sparire testi che
 * l'utente sa di avere scritto.
 */
const elenco = useEventiPropri([30023, 30024], { limite: 100 })
const bozzeLocali = useBozzeLocali()

const pubblicati = computed(() => elenco.eventi.value.filter((e) => e.kind === 30023))
const legacy = computed(() => elenco.eventi.value.filter((e) => e.kind === 30024))

function identificatoreDi(tags: string[][]): string {
  return tags.find((t) => t[0] === 'd')?.[1] ?? ''
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">I tuoi articoli</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">
          Kind 30023 — long-form, modificabili ripubblicando con lo stesso identificatore.
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
        <BaseButton to="/articoli/nuovo" variant="primario">Scrivi</BaseButton>
      </div>
    </div>

    <BaseAlert v-if="elenco.errore.value" tono="pericolo">{{ elenco.errore.value }}</BaseAlert>

    <ClientOnly>
      <BaseCard v-if="bozzeLocali.bozze.value.length" title="Bozze in questo browser">
        <ul class="flex flex-col gap-2">
          <li
            v-for="b in bozzeLocali.bozze.value"
            :key="b.identifier"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="flex-1 truncate">{{ b.title || b.identifier }}</span>
            <span class="text-xs text-[var(--testo-tenue)]">
              {{ tempoRelativo(new Date(b.salvataAlle)) }}
            </span>
            <BaseButton size="sm" :to="`/articoli/nuovo?d=${encodeURIComponent(b.identifier)}`">
              Riprendi
            </BaseButton>
          </li>
        </ul>
      </BaseCard>

      <SenzaIdentita v-if="elenco.senzaIdentita.value" cosa="gli articoli" />

      <div
        v-else-if="elenco.caricamento.value && !elenco.eventi.value.length"
        class="flex flex-col gap-3"
      >
        <div v-for="n in 2" :key="n" class="superficie h-32 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!elenco.eventi.value.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">Nessun articolo tuo sui relay di lettura.</p>
          <BaseButton to="/articoli/nuovo" variant="primario">Scrivi il primo</BaseButton>
        </div>
      </BaseCard>

      <template v-else>
        <section v-if="pubblicati.length" class="flex flex-col gap-3">
          <div v-for="e in pubblicati" :key="e.id" class="flex flex-col gap-1">
            <EventKindRenderer :evento="e" />
            <p class="pl-1">
              <NuxtLink
                :to="`/articoli/nuovo?d=${encodeURIComponent(identificatoreDi(e.tags))}`"
                class="text-xs underline"
              >
                Modifica →
              </NuxtLink>
            </p>
          </div>
        </section>

        <section v-if="legacy.length" class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-[var(--testo-tenue)]">
            Bozze legacy sui relay (kind 30024)
          </h2>
          <BaseAlert tono="avviso">
            Questi eventi stanno sui relay
            <strong>in chiaro</strong>
            : chiunque abbia accesso a quel relay li legge. NIP-23 dichiara deprecato il kind 30024
            proprio per questo.
          </BaseAlert>
          <EventKindRenderer v-for="e in legacy" :key="e.id" :evento="e" />
        </section>
      </template>
    </ClientOnly>
  </div>
</template>
