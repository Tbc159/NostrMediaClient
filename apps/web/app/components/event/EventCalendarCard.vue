<script setup lang="ts">
import { addressOf, formatInTimezone, type NostrEvent } from '@nmc/nostr-core'

/**
 * A calendar event, kind 31922 (on a date) or 31923 (with a time).
 *
 * The two kinds are shown differently because they *are* different: the 31922
 * has neither a time nor a zone and is to be read as written, the 31923 is an
 * absolute instant to be shown in the zone the organiser declared. Rendering
 * them the same way would mean inventing a time where there is none or losing
 * the zone where there is one.
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

/** The coordinate an answer has to point at: not the id, which changes on every edit. */
const coordinata = computed(() => addressOf(props.evento))

/** The observer's zone, used only to say whether it differs from the event's. */
const fusoLocale = Intl.DateTimeFormat().resolvedOptions().timeZone

const quandoPrincipale = computed(() => {
  if (!conOrario.value) return formattaGiorno(String(props.dati.start))
  const tz = props.dati.startTzid ?? fusoLocale
  return formatInTimezone(Number(props.dati.start), tz)
})

/**
 * A second time, shown only when the event takes place in a zone other than
 * your own. Always repeating it would be noise; always omitting it would make
 * whoever attends from another country late.
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
    // NIP-52 defines `end` as exclusive: the last day included is the one
    // before, and showing the raw date would suggest a day more.
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
