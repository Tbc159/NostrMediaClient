<script setup lang="ts">
import type { EsitoRelay, RisultatoPubblicazione } from '@nmc/nostr-core'

/**
 * Esito di una pubblicazione, relay per relay.
 *
 * Deliberatamente non riassume in "pubblicato" o "non pubblicato": un evento
 * accettato da due relay su cinque e' un caso normale su Nostr, e l'utente
 * deve poter vedere quali due — e' da li' che capisce se il suo relay privato
 * sta funzionando o se sta scrivendo solo su quelli pubblici.
 */
const props = defineProps<{ esito: RisultatoPubblicazione }>()

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

const accettati = computed(() => props.esito.accettati.length)

/*
 * Con la rotazione i relay non tentati non sono fallimenti: contarli nel
 * denominatore farebbe leggere «1 su 4» a una pubblicazione andata come
 * doveva.
 */
const tentati = computed(
  () => props.esito.risultati.filter((r) => r.esito !== 'non tentato').length,
)
const saltati = computed(() => props.esito.risultati.length - tentati.value)
</script>

<template>
  <div class="flex flex-col gap-3">
    <BaseAlert :tono="esito.riuscita ? 'successo' : 'pericolo'">
      <template v-if="esito.riuscita">
        Evento accettato da {{ accettati }} su {{ tentati }} relay contattati.
        <template v-if="saltati > 0">
          Gli altri {{ saltati }} non sono stati contattati: bastava il primo che lo ha preso in
          carico.
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
        v-for="r in esito.risultati"
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
