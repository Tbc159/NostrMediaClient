<script setup lang="ts">
useHead({ title: 'Media · NostrMediaClient' })

/**
 * Kind 20, 21, 22 e 1063 insieme: sono modi diversi di descrivere la stessa
 * cosa — un file su un server, riferito da un evento — e separarli in quattro
 * elenchi costringerebbe l'utente a ricordare con quale kind aveva pubblicato.
 */
const elenco = useEventiPropri([20, 21, 22, 1063], { limite: 100 })

const perKind = computed(() => {
  const conteggio = new Map<number, number>()
  for (const e of elenco.eventi.value) conteggio.set(e.kind, (conteggio.get(e.kind) ?? 0) + 1)
  return conteggio
})

const nomiKind: Record<number, string> = {
  20: 'gallerie',
  21: 'video',
  22: 'video corti',
  1063: 'schede file',
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">I tuoi media</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">
          Kind 20, 21, 22 e 1063 — immagini, video e schede file.
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
        <BaseButton to="/media/nuovo" variant="primario">Carica</BaseButton>
      </div>
    </div>

    <BaseAlert v-if="elenco.errore.value" tono="pericolo">{{ elenco.errore.value }}</BaseAlert>

    <ClientOnly>
      <SenzaIdentita v-if="elenco.senzaIdentita.value" cosa="i media" />

      <div
        v-else-if="elenco.caricamento.value && !elenco.eventi.value.length"
        class="flex flex-col gap-3"
      >
        <div v-for="n in 2" :key="n" class="superficie h-48 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!elenco.eventi.value.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">
            Non hai ancora pubblicato media da questo client.
          </p>
          <BaseButton to="/media/nuovo" variant="primario">Carica il primo file</BaseButton>
        </div>
      </BaseCard>

      <template v-else>
        <p class="flex flex-wrap gap-2 text-xs">
          <BaseBadge v-for="[kind, n] in perKind" :key="kind">
            {{ n }} {{ nomiKind[kind] ?? `kind ${kind}` }}
          </BaseBadge>
        </p>
        <div class="flex flex-col gap-3">
          <EventKindRenderer v-for="e in elenco.eventi.value" :key="e.id" :evento="e" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
