<script setup lang="ts">
/**
 * The Podcast tab: the uploader in its episode guise, with the drafts left
 * half-finished above it. They are here and not in «Upload to Blossom»
 * because they are episode drafts, and the place to find them again is where
 * they get published.
 */
useHead({ title: 'Podcast · NostrMediaClient' })

const bozze = useBozzeEpisodio()
const rotta = useRoute()

const quando = (secondi: number): string =>
  new Date(secondi * 1000).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })

// With a draft open the list would be noise above the form that shows it.
const elencoVisibile = computed(() => bozze.bozze.value.length > 0 && !rotta.query.bozza)
</script>

<template>
  <div class="flex flex-col gap-6">
    <MediaSchede />

    <ClientOnly>
      <BaseCard
        v-if="elencoVisibile"
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
                {{ b.allegati.length }} file su Blossom · aggiornata {{ quando(b.aggiornataAlle) }}
                <template v-if="b.perChiave">· per {{ b.perChiave.slice(0, 16) }}…</template>
              </span>
            </span>
            <BaseButton size="sm" variant="primario" :to="`/media/podcast?bozza=${b.id}`">
              Riprendi
            </BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="bozze.elimina(b.id)">
              Elimina
            </BaseButton>
          </li>
        </ul>
      </BaseCard>
    </ClientOnly>

    <MediaCaricaMedia modalita="podcast" />

    <ClientOnly>
      <MediaPiattaforme />
    </ClientOnly>
  </div>
</template>
