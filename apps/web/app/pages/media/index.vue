<script setup lang="ts">
useHead({ title: 'Media · NostrMediaClient' })

/**
 * Kind 20, 21, 22, 1063 e 54 insieme: sono modi diversi di descrivere la
 * stessa cosa — un file su un server, riferito da un evento — e separarli in
 * cinque elenchi costringerebbe l'utente a ricordare con quale kind aveva
 * pubblicato.
 */
const elenco = useEventiPropri([20, 21, 22, 1063, 54], { limite: 100 })

/**
 * Le bozze di episodio stanno qui e non in una pagina a parte: sono lavoro
 * lasciato a meta', e il posto per ritrovarlo e' dove si vede il resto.
 */
const bozze = useBozzeEpisodio()

const quando = (secondi: number): string =>
  new Date(secondi * 1000).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })

const perKind = computed(() => {
  const conteggio = new Map<number, number>()
  for (const e of elenco.eventi.value) conteggio.set(e.kind, (conteggio.get(e.kind) ?? 0) + 1)
  return conteggio
})

const nomiKind: Record<number, string> = {
  20: 'gallerie',
  21: 'video',
  22: 'video corti',
  54: 'episodi podcast',
  1063: 'schede file',
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <MediaSchede />

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">I tuoi media</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">
          Kind 20, 21, 22, 1063 e 54 — immagini, video, schede file ed episodi di podcast.
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
      <!-- ─────────── Bozze di episodio ─────────── -->
      <BaseCard
        v-if="bozze.bozze.value.length"
        title="Bozze di episodio"
        subtitle="Lavoro lasciato a metà, salvato in questo browser. I file sono già su Blossom."
      >
        <ul class="flex flex-col gap-2">
          <li
            v-for="b in bozze.bozze.value"
            :key="b.id"
            class="superficie flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <span class="min-w-0 flex-1">
              <strong>{{ b.episodio.titolo || 'Senza titolo' }}</strong>
              <span class="block text-xs text-[var(--testo-tenue)]">
                {{ b.allegati.length }}
                {{ b.allegati.length === 1 ? 'file' : 'file' }} su Blossom · aggiornata
                {{ quando(b.aggiornataAlle) }}
                <template v-if="b.perChiave">· per {{ b.perChiave.slice(0, 16) }}…</template>
              </span>
            </span>
            <BaseButton size="sm" variant="primario" :to="`/media/nuovo?bozza=${b.id}`">
              Riprendi
            </BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="bozze.elimina(b.id)">
              Elimina
            </BaseButton>
          </li>
        </ul>
      </BaseCard>

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
