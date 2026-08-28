<script setup lang="ts">
import { addressOf, formatInTimezone, type NostrEvent } from '@nmc/nostr-core'

/**
 * Evento di calendario, kind 31922 (su data) o 31923 (con orario).
 *
 * I due kind si mostrano diversamente perche' *sono* diversi: il 31922 non ha
 * orario ne' fuso e va letto come sta scritto, il 31923 e' un istante assoluto
 * che va mostrato nel fuso dichiarato dall'organizzatore. Renderli allo stesso
 * modo significherebbe inventare un orario dove non c'e' o perdere il fuso
 * dove c'e'.
 */
const props = defineProps<{
  evento: NostrEvent
  dati: {
    title: string
    description: string
    summary?: string
    locations: string[]
    start: string | number
    end?: string | number
    startTzid?: string
    endTzid?: string
  }
}>()

const conOrario = computed(() => props.evento.kind === 31923)

/** Coordinata a cui una risposta deve puntare: non l'id, che cambia a ogni modifica. */
const coordinata = computed(() => addressOf(props.evento))

/** Fuso dell'osservatore, usato solo per dire se differisce da quello dell'evento. */
const fusoLocale = Intl.DateTimeFormat().resolvedOptions().timeZone

const quandoPrincipale = computed(() => {
  if (!conOrario.value) return formattaGiorno(String(props.dati.start))
  const tz = props.dati.startTzid ?? fusoLocale
  return formatInTimezone(Number(props.dati.start), tz)
})

/**
 * Secondo orario, mostrato solo quando l'evento si svolge in un fuso diverso
 * dal proprio. Ripeterlo sempre sarebbe rumore; ometterlo sempre farebbe
 * arrivare in ritardo chi partecipa da un altro paese.
 */
const quandoLocale = computed(() => {
  if (!conOrario.value) return null
  const tz = props.dati.startTzid
  if (!tz || tz === fusoLocale) return null
  return `${formatInTimezone(Number(props.dati.start), fusoLocale)} (ora tua)`
})

const fineMostrata = computed(() => {
  if (props.dati.end === undefined) return null
  if (!conOrario.value) {
    // NIP-52 definisce `end` esclusivo: l'ultimo giorno compreso e' il
    // precedente, e mostrare la data grezza farebbe credere a un giorno in piu'.
    return `fino al ${formattaGiorno(giornoPrecedente(String(props.dati.end)))} compreso`
  }
  const tz = props.dati.endTzid ?? props.dati.startTzid ?? fusoLocale
  return `fino alle ${formatInTimezone(Number(props.dati.end), tz)}`
})

function formattaGiorno(iso: string): string {
  const [anno, mese, giorno] = iso.split('-').map(Number)
  if (!anno || !mese || !giorno) return iso
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(Date.UTC(anno, mese - 1, giorno)),
  )
}

function giornoPrecedente(iso: string): string {
  const [anno, mese, giorno] = iso.split('-').map(Number)
  if (!anno || !mese || !giorno) return iso
  const d = new Date(Date.UTC(anno, mese - 1, giorno - 1))
  return d.toISOString().slice(0, 10)
}
</script>

<template>
  <EventShell :evento="evento" :etichetta="conOrario ? 'con orario' : 'giornata intera'">
    <h3 class="text-base font-semibold">{{ dati.title }}</h3>

    <dl class="mt-2 flex flex-col gap-1 text-sm">
      <div class="flex flex-wrap gap-x-2">
        <dt class="text-[var(--testo-tenue)]">Quando</dt>
        <dd>
          {{ quandoPrincipale }}
          <span v-if="dati.startTzid && conOrario" class="text-xs text-[var(--testo-tenue)]">
            ({{ dati.startTzid }})
          </span>
        </dd>
      </div>
      <div v-if="quandoLocale" class="flex flex-wrap gap-x-2 text-xs text-[var(--testo-tenue)]">
        <dt class="sr-only">Nel tuo fuso</dt>
        <dd>{{ quandoLocale }}</dd>
      </div>
      <div v-if="fineMostrata" class="flex flex-wrap gap-x-2 text-xs text-[var(--testo-tenue)]">
        <dt class="sr-only">Fine</dt>
        <dd>{{ fineMostrata }}</dd>
      </div>
      <div v-if="dati.locations.length" class="flex flex-wrap gap-x-2">
        <dt class="text-[var(--testo-tenue)]">Dove</dt>
        <dd>{{ dati.locations.join(' · ') }}</dd>
      </div>
    </dl>

    <p v-if="dati.summary" class="mt-2 text-sm text-[var(--testo-tenue)]">{{ dati.summary }}</p>
    <p v-if="dati.description" class="mt-2 whitespace-pre-wrap break-words text-sm">
      {{ dati.description }}
    </p>

    <template #azioni>
      <NuxtLink :to="`/calendario/rsvp?a=${encodeURIComponent(coordinata)}`" class="underline">
        Rispondi all’invito →
      </NuxtLink>
    </template>
  </EventShell>
</template>
