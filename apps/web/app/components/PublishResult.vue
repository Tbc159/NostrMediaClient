<script setup lang="ts">
import type { EsitoRelay, RisultatoPubblicazione } from '@nmc/nostr-core'

/**
 * The outcome of a publication, relay by relay.
 *
 * Deliberately not summarised into "published" or "not published": an event
 * accepted by two relays out of five is a normal case on Nostr, and the user
 * has to be able to see which two — that is how they tell whether their
 * private relay is working or whether they are writing only to the public
 * ones.
 */
const props = defineProps<{ esito: RisultatoPubblicazione }>()

/*
 * The outcome shown can change from here: with the rotation the event is on a
 * single relay, and whoever wants it on the others too has nothing to
 * recompose — it is signed already. The same event is sent again with «all»
 * and the new outcome is shown in place of the old.
 */
const invio = usePublish()
const esitoMostrato = ref<RisultatoPubblicazione>(props.esito)
watch(
  () => props.esito,
  (e) => (esitoMostrato.value = e),
)

async function ridistribuisci(): Promise<void> {
  await invio.pubblica(esitoMostrato.value.evento, undefined, { strategia: 'tutti' })
  if (invio.esito.value) esitoMostrato.value = invio.esito.value
}

const toni: Record<EsitoRelay, 'successo' | 'avviso' | 'neutro'> = {
  accettato: 'successo',
  duplicato: 'successo',
  rifiutato: 'avviso',
  autenticazione: 'avviso',
  irraggiungibile: 'neutro',
  'non tentato': 'neutro',
}

const etichette: Record<EsitoRelay, string> = {
  accettato: 'accettato',
  duplicato: 'già presente',
  rifiutato: 'rifiutato',
  autenticazione: 'autenticazione',
  irraggiungibile: 'nessuna risposta',
  'non tentato': 'non tentato',
}

const accettati = computed(() => esitoMostrato.value.accettati.length)

/*
 * With the rotation the relays not tried are not failures: counting them in
 * the denominator would have a publication that went as it should read «1 out
 * of 4».
 */
const tentati = computed(
  () => esitoMostrato.value.risultati.filter((r) => r.esito !== 'non tentato').length,
)
const saltati = computed(() => esitoMostrato.value.risultati.length - tentati.value)
</script>

<template>
  <div class="flex flex-col gap-3">
    <BaseAlert :tono="esitoMostrato.riuscita ? 'successo' : 'pericolo'">
      <template v-if="esitoMostrato.riuscita">
        Evento accettato da {{ accettati }} su {{ tentati }} relay contattati.
        <template v-if="saltati > 0">
          Gli altri {{ saltati }} non sono stati contattati: bastava il primo che lo ha preso in
          carico. Se vuoi che ci sia anche lì:
          <button
            type="button"
            class="underline"
            :disabled="invio.inCorso.value"
            @click="ridistribuisci"
          >
            {{ invio.inCorso.value ? 'ridistribuisco…' : 'ridistribuisci su tutti' }}
          </button>
        </template>
        <template v-else-if="accettati < tentati">
          Gli altri non lo hanno preso: sotto trovi il motivo di ciascuno.
        </template>
      </template>
      <template v-else>
        Nessuno dei {{ tentati }} relay contattati ha accettato l’evento. La firma è valida e
        l’evento resta copiabile: puoi cambiare relay dalle impostazioni e riprovare.
      </template>
    </BaseAlert>

    <ul class="flex flex-col gap-2">
      <li
        v-for="r in esitoMostrato.risultati"
        :key="r.url"
        class="superficie flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
        :class="r.esito === 'non tentato' ? 'opacity-60' : ''"
      >
        <BaseBadge :tono="toni[r.esito]">{{ etichette[r.esito] }}</BaseBadge>
        <code class="text-xs text-[var(--testo-tenue)]">{{ r.url }}</code>
        <span class="w-full text-xs text-[var(--testo-tenue)] sm:w-auto sm:flex-1">
          {{ r.motivo }}
        </span>
      </li>
    </ul>
  </div>
</template>
