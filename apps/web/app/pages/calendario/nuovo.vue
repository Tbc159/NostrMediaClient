<script setup lang="ts">
import {
  availableTimezones,
  formatInTimezone,
  getKindDefinition,
  localTimezone,
  newCalendarIdentifier,
  unixToZoned,
  zonedToUnix,
} from '@nmc/nostr-core'

useHead({ title: 'Nuovo evento · NostrMediaClient' })

const identita = useIdentity()
const bozza = useEventDraft()

/** Tutto il giorno → kind 31922, con orario → kind 31923. */
const tuttoIlGiorno = ref(false)

const identificatore = ref(newCalendarIdentifier())
const titolo = ref('')
const descrizione = ref('')
const sommario = ref('')
const luogo = ref('')
const immagine = ref('')
const partecipanti = ref('')
const hashtag = ref('')

const dataInizio = ref('')
const oraInizio = ref('09:00')
const dataFine = ref('')
const oraFine = ref('10:00')
const fuso = ref('UTC')
const conFine = ref(true)

onMounted(() => {
  // Il fuso del dispositivo si legge solo nel browser: in SSR darebbe quello
  // del server, che non c'entra nulla con l'utente.
  fuso.value = localTimezone()
  const oggi = new Date().toISOString().slice(0, 10)
  dataInizio.value = oggi
  dataFine.value = oggi
})

/** Giorno successivo a una data ISO, restando su UTC per non slittare. */
function giornoDopo(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/*
 * Su un evento di giornata intera NIP-52 definisce la fine come ESCLUSIVA:
 * una fine uguale all'inizio descrive una durata nulla e viene rifiutata.
 * Il form si corregge da solo invece di lasciare l'utente davanti a un errore
 * che non ha causato lui.
 */
watch([tuttoIlGiorno, dataInizio, conFine], () => {
  if (!tuttoIlGiorno.value || !conFine.value || !dataInizio.value) return
  if (!dataFine.value || dataFine.value <= dataInizio.value) {
    dataFine.value = giornoDopo(dataInizio.value)
  }
})

const fusiDisponibili = computed(() => {
  const elenco = availableTimezones()
  const base = elenco.length ? elenco : ['UTC', 'Europe/Rome']
  return base.map((tz) => ({ value: tz, label: tz }))
})

const listaPartecipanti = computed(() =>
  partecipanti.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)
const listaHashtag = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

/** Anteprima leggibile dell'istante, per confermare che il fuso sia quello atteso. */
const anteprimaInizio = computed(() => {
  if (tuttoIlGiorno.value || !dataInizio.value) return null
  try {
    const unix = zonedToUnix(dataInizio.value, oraInizio.value, fuso.value)
    return {
      nelFuso: formatInTimezone(unix, fuso.value),
      quiDaTe: formatInTimezone(unix, localTimezone()),
      diverso: unixToZoned(unix, fuso.value).time !== unixToZoned(unix, localTimezone()).time,
    }
  } catch {
    return null
  }
})

const puoComporre = computed(() => titolo.value.trim() !== '' && dataInizio.value !== '')

function componi(): void {
  const kind = tuttoIlGiorno.value ? 31922 : 31923
  const definizione = getKindDefinition(kind)
  if (!definizione) {
    bozza.errore.value = `Kind ${kind} non registrato.`
    return
  }

  const comune = {
    identifier: identificatore.value,
    title: titolo.value.trim(),
    description: descrizione.value,
    ...(sommario.value.trim() ? { summary: sommario.value.trim() } : {}),
    ...(luogo.value.trim() ? { location: luogo.value.trim() } : {}),
    ...(immagine.value.trim() ? { image: immagine.value.trim() } : {}),
    ...(listaPartecipanti.value.length ? { participants: listaPartecipanti.value } : {}),
    ...(listaHashtag.value.length ? { hashtags: listaHashtag.value } : {}),
  }

  if (tuttoIlGiorno.value) {
    bozza.costruisci(definizione, {
      ...comune,
      start: dataInizio.value,
      ...(conFine.value && dataFine.value ? { end: dataFine.value } : {}),
    })
    return
  }

  try {
    const start = zonedToUnix(dataInizio.value, oraInizio.value, fuso.value)
    const end =
      conFine.value && dataFine.value
        ? zonedToUnix(dataFine.value, oraFine.value, fuso.value)
        : undefined
    bozza.costruisci(definizione, {
      ...comune,
      start,
      ...(end !== undefined ? { end } : {}),
      startTzid: fuso.value,
    })
  } catch (e) {
    bozza.errore.value = e instanceof Error ? e.message : String(e)
  }
}

function nuovo(): void {
  identificatore.value = newCalendarIdentifier()
  titolo.value = ''
  descrizione.value = ''
  sommario.value = ''
  luogo.value = ''
  immagine.value = ''
  partecipanti.value = ''
  hashtag.value = ''
  bozza.azzera()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Nuovo evento</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">
        Kind {{ tuttoIlGiorno ? '31922 — su data' : '31923 — con orario' }} (NIP-52).
      </p>
    </div>

    <ClientOnly>
      <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
        {{ identita.motivoNonFirmabile }}
        <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
        .
      </BaseAlert>
    </ClientOnly>

    <BaseCard>
      <form class="flex flex-col gap-5" @submit.prevent="componi">
        <fieldset class="flex flex-col gap-3">
          <legend class="sr-only">Tipo di evento</legend>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="tuttoIlGiorno" type="checkbox" class="size-4" />
            Evento di un giorno intero, senza orario
          </label>
          <p class="text-xs text-[var(--testo-tenue)]">
            Un compleanno o una festività è «il 3 marzo» ovunque lo si guardi: senza orario non
            serve un fuso, e non si rischia di spostarlo di un giorno.
          </p>
        </fieldset>

        <BaseField v-slot="{ id, describedBy }" label="Titolo" required>
          <BaseInput :id="id" v-model="titolo" :described-by="describedBy" />
        </BaseField>

        <BaseField v-slot="{ id, describedBy }" label="Descrizione">
          <BaseTextarea :id="id" v-model="descrizione" :rows="4" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Sommario"
          hint="Riga breve mostrata negli elenchi."
        >
          <BaseInput :id="id" v-model="sommario" :described-by="describedBy" />
        </BaseField>

        <!-- ── Quando ── -->
        <div class="flex flex-col gap-4 rounded-lg border border-[var(--bordo)] p-4">
          <h2 class="text-sm font-medium">Quando</h2>

          <div class="grid gap-4 sm:grid-cols-2">
            <BaseField v-slot="{ id, describedBy }" label="Data di inizio" required>
              <BaseInput :id="id" v-model="dataInizio" type="date" :described-by="describedBy" />
            </BaseField>
            <BaseField v-if="!tuttoIlGiorno" v-slot="{ id, describedBy }" label="Ora di inizio">
              <BaseInput :id="id" v-model="oraInizio" type="time" :described-by="describedBy" />
            </BaseField>
          </div>

          <label class="flex items-center gap-2 text-sm">
            <input v-model="conFine" type="checkbox" class="size-4" />
            L’evento ha una fine
          </label>

          <div v-if="conFine" class="grid gap-4 sm:grid-cols-2">
            <BaseField
              v-slot="{ id, describedBy }"
              label="Data di fine"
              :hint="
                tuttoIlGiorno
                  ? 'Esclusiva: per un evento di un solo giorno metti il giorno dopo, o togli la fine.'
                  : undefined
              "
            >
              <BaseInput :id="id" v-model="dataFine" type="date" :described-by="describedBy" />
            </BaseField>
            <BaseField v-if="!tuttoIlGiorno" v-slot="{ id, describedBy }" label="Ora di fine">
              <BaseInput :id="id" v-model="oraFine" type="time" :described-by="describedBy" />
            </BaseField>
          </div>

          <template v-if="!tuttoIlGiorno">
            <BaseField
              v-slot="{ id, describedBy }"
              label="Fuso orario"
              hint="Il fuso in cui l’evento va letto: viene conservato accanto all’istante."
            >
              <BaseSelect
                :id="id"
                v-model="fuso"
                :options="fusiDisponibili"
                :described-by="describedBy"
              />
            </BaseField>

            <div
              v-if="anteprimaInizio"
              class="rounded-md bg-[var(--sfondo-alt)] p-3 text-xs leading-relaxed"
            >
              <p>
                <strong>Nel fuso dell’evento:</strong>
                {{ anteprimaInizio.nelFuso }}
              </p>
              <p v-if="anteprimaInizio.diverso" class="mt-1 text-[var(--testo-tenue)]">
                <strong>Sul tuo orologio:</strong>
                {{ anteprimaInizio.quiDaTe }}
              </p>
            </div>
          </template>
        </div>

        <!-- ── Dove e chi ── -->
        <BaseField v-slot="{ id, describedBy }" label="Luogo">
          <BaseInput :id="id" v-model="luogo" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Immagine"
          hint="URL di una locandina o copertina."
        >
          <BaseInput :id="id" v-model="immagine" type="url" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Partecipanti"
          hint="Chiavi pubbliche esadecimali, separate da spazio o virgola."
        >
          <BaseInput :id="id" v-model="partecipanti" :described-by="describedBy" />
        </BaseField>

        <BaseField v-slot="{ id, describedBy }" label="Hashtag">
          <BaseInput :id="id" v-model="hashtag" :described-by="describedBy" />
        </BaseField>

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario" :disabled="!puoComporre">
            Componi evento
          </BaseButton>
          <ClientOnly>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firma()"
            >
              Firma
            </BaseButton>
          </ClientOnly>
          <BaseButton v-if="bozza.template.value" variant="fantasma" @click="nuovo">
            Nuovo evento
          </BaseButton>
        </div>

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.template.value" title="Evento">
      <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
    </BaseCard>

    <BaseAlert tono="info">
      Gli eventi calendario sono
      <strong>addressable</strong>
      : ripubblicandoli con lo stesso identificatore
      <code class="font-mono text-xs">{{ identificatore.slice(0, 8) }}…</code>
      il relay sostituisce la versione precedente. È così che funziona la modifica, e per questo
      l’identificatore non va rigenerato quando correggi un evento esistente.
    </BaseAlert>
  </div>
</template>
