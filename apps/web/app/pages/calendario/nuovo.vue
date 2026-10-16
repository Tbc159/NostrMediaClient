<script setup lang="ts">
import {
  availableTimezones,
  formatInTimezone,
  getKindDefinition,
  localTimezone,
  newCalendarIdentifier,
  normalizeHashtag,
  unixToZoned,
  zonedToUnix,
} from '@nmc/nostr-core'

const identita = useIdentity()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const rotta = useRoute()

/** True when an already published event is being reopened. */
const modifica = ref(false)

useHead({
  title: () => (modifica.value ? 'Modifica evento' : 'Nuovo evento') + ' · NostrMediaClient',
})

/** All day → kind 31922, with a time → kind 31923. */
const tuttoIlGiorno = ref(false)

const identificatore = ref(newCalendarIdentifier())
const titolo = ref('')
const descrizione = ref('')
const sommario = ref('')
const luogo = ref('')
const immagine = ref('')
const partecipanti = ref('')

/*
 * The hashtags are a list, not a line of text.
 *
 * Split on spaces, another client's «Food & drink» category became three tags
 * — «food», «&», «drink» — and the event went back to the relays worse than
 * it had arrived. As separate items there is nothing to split: the ones read
 * stay as they were, and only the ones written here go through the lower-case
 * convention.
 */
const hashtag = ref<string[]>([])
const nuovoHashtag = ref('')

function aggiungiHashtag(): void {
  const pulito = normalizeHashtag(nuovoHashtag.value)
  if (pulito && !hashtag.value.includes(pulito)) hashtag.value = [...hashtag.value, pulito]
  nuovoHashtag.value = ''
}
const togliHashtag = (v: string): void => {
  hashtag.value = hashtag.value.filter((h) => h !== v)
}

/*
 * The tags this form does not write: read from the event when it is reopened
 * and republished with it. It holds for another client's colours and
 * coordinates, but also for what the kind could write and the form does not
 * pass it — `g`, `r`, `a`, the participants' roles.
 */
const conservati = useTagConservati(() => nomiDelForm.value)
const tagExtra = conservati.tags

const dataInizio = ref('')
const oraInizio = ref('09:00')
const dataFine = ref('')
const oraFine = ref('10:00')
const fuso = ref('UTC')
const conFine = ref(true)

onMounted(async () => {
  // The device's zone is read in the browser alone: in SSR it would give the
  // server's, which has nothing to do with the user.
  fuso.value = localTimezone()
  const oggi = new Date().toISOString().slice(0, 10)
  dataInizio.value = oggi
  dataFine.value = oggi

  const d = rotta.query.d
  const kindRichiesto = Number(rotta.query.kind)
  if (typeof d === 'string' && d && (kindRichiesto === 31922 || kindRichiesto === 31923)) {
    await riapri(kindRichiesto, d)
  }
})

/**
 * Reopens a published event.
 *
 * The identifier is **not** regenerated: it is the `d` tag, and it is what
 * makes this a replacement instead of a new event. Changing it here would
 * leave the original lying about and create a second one.
 */
async function riapri(kind: number, d: string): Promise<void> {
  const trovato = await esistente.perCoordinata(kind, d)
  if (!trovato) return

  const definizione = getKindDefinition(kind)
  if (!definizione) return

  try {
    const dati = definizione.parse(trovato)
    modifica.value = true
    tuttoIlGiorno.value = kind === 31922
    identificatore.value = dati.identifier
    titolo.value = dati.title
    descrizione.value = dati.description
    sommario.value = dati.summary ?? ''
    luogo.value = dati.locations.join(', ')
    immagine.value = dati.image ?? ''
    partecipanti.value = dati.participants.map((p: { pubkey: string }) => p.pubkey).join(' ')
    hashtag.value = [...dati.hashtags]
    // The snapshot of the tags is taken now, on the event as it stands on the relays.
    conservati.fotografa(definizione, trovato, inputDa(dati, kind))

    if (kind === 31922) {
      dataInizio.value = dati.start
      conFine.value = dati.end !== undefined
      if (dati.end) dataFine.value = dati.end
      return
    }

    // The timestamp is an absolute instant: to put it back into the date and
    // time fields it has to be brought into the zone the event declared, not
    // the editor's. Otherwise reopening from Rome a meeting set in Tokyo would
    // show a time other than the one the organiser had written.
    fuso.value = dati.startTzid ?? localTimezone()
    const inizio = unixToZoned(dati.start, fuso.value)
    dataInizio.value = inizio.date
    oraInizio.value = inizio.time

    conFine.value = dati.end !== undefined
    if (dati.end !== undefined) {
      const fine = unixToZoned(dati.end, dati.endTzid ?? fuso.value)
      dataFine.value = fine.date
      oraFine.value = fine.time
    }
  } catch (e) {
    esistente.errore.value = `L’evento pubblicato non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** The day after an ISO date, staying on UTC so as not to slip. */
function giornoDopo(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/*
 * On a whole-day event NIP-52 defines the end as EXCLUSIVE: an end equal to
 * the start describes a duration of zero and is refused. The form corrects
 * itself instead of leaving the user in front of an error they did not cause.
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

/** A readable preview of the instant, to confirm the zone is the expected one. */
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

/**
 * The input the form would produce starting from an event that was read.
 *
 * Only the snapshot of the tags needs it: it is the «what the kind would write
 * for this event», and the difference from the real event is the tags to keep.
 */
function inputDa(dati: Record<string, unknown>, kind: number): Record<string, unknown> {
  const d = dati as {
    identifier: string
    title: string
    description: string
    summary?: string
    image?: string
    locations: string[]
    hashtags: string[]
    start: number | string
    end?: number | string
    startTzid?: string
  }
  return {
    identifier: d.identifier,
    title: d.title,
    description: d.description,
    ...(d.summary ? { summary: d.summary } : {}),
    ...(d.image ? { image: d.image } : {}),
    ...(d.locations.length ? { location: d.locations } : {}),
    ...(d.hashtags.length ? { hashtags: d.hashtags } : {}),
    start: d.start,
    ...(d.end !== undefined ? { end: d.end } : {}),
    ...(kind === 31923 && d.startTzid ? { startTzid: d.startTzid } : {}),
  }
}

/** The names of the tags this form composes: the warning about duplicates needs them. */
const nomiDelForm = computed(() =>
  tuttoIlGiorno.value
    ? ['d', 'title', 'summary', 'image', 'location', 't', 'start', 'end', 'client']
    : [
        'd',
        'title',
        'summary',
        'image',
        'location',
        't',
        'start',
        'end',
        'D',
        'start_tzid',
        'client',
      ],
)

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
    ...(hashtag.value.length ? { hashtags: hashtag.value } : {}),
  }

  if (tuttoIlGiorno.value) {
    bozza.costruisci(
      definizione,
      {
        ...comune,
        start: dataInizio.value,
        ...(conFine.value && dataFine.value ? { end: dataFine.value } : {}),
      },
      { aggiuntivi: tagExtra.value },
    )
    return
  }

  try {
    const start = zonedToUnix(dataInizio.value, oraInizio.value, fuso.value)
    const end =
      conFine.value && dataFine.value
        ? zonedToUnix(dataFine.value, oraFine.value, fuso.value)
        : undefined
    bozza.costruisci(
      definizione,
      {
        ...comune,
        start,
        ...(end !== undefined ? { end } : {}),
        startTzid: fuso.value,
      },
      { aggiuntivi: tagExtra.value },
    )
  } catch (e) {
    bozza.errore.value = e instanceof Error ? e.message : String(e)
  }
}

function nuovo(): void {
  modifica.value = false
  esistente.errore.value = null
  identificatore.value = newCalendarIdentifier()
  titolo.value = ''
  descrizione.value = ''
  sommario.value = ''
  luogo.value = ''
  immagine.value = ''
  partecipanti.value = ''
  hashtag.value = []
  nuovoHashtag.value = ''
  conservati.azzera()
  bozza.azzera()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">
          {{ modifica ? 'Modifica evento' : 'Nuovo evento' }}
        </h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">
          Kind {{ tuttoIlGiorno ? '31922 — su data' : '31923 — con orario' }} (NIP-52).
        </p>
      </div>
      <BaseButton to="/calendario" variant="fantasma">← Torna al calendario</BaseButton>
    </div>

    <ClientOnly>
      <div
        v-if="esistente.caricamento.value"
        class="superficie h-16 animate-pulse rounded-xl border"
      />
      <BaseAlert v-if="esistente.errore.value" tono="pericolo">
        {{ esistente.errore.value }}
      </BaseAlert>
      <BaseAlert v-if="modifica" tono="info">
        Stai modificando un evento già pubblicato. Ripubblicandolo con lo stesso identificatore
        <code class="font-mono text-xs">{{ identificatore.slice(0, 8) }}…</code>
        il relay sostituisce la versione precedente: è così che funziona la modifica sugli eventi
        addressable.
      </BaseAlert>
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

        <!-- ── When ── -->
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

        <!-- ── Where and who ── -->
        <BaseField v-slot="{ id, describedBy }" label="Luogo">
          <BaseInput :id="id" v-model="luogo" :described-by="describedBy" />
        </BaseField>

        <!--
          The image is uploaded from here: whoever has the poster on disk
          should not have to interrupt composing the event, go to Media, upload
          it, copy the address and come back. The same field as the article's,
          with the list of the ones already on Blossom — which for a poster is
          the commonest case, because it has often been used elsewhere already.
        -->
        <MediaCampoImmagine
          v-model="immagine"
          label="Immagine"
          hint="Locandina o copertina: caricala da qui, scegline una già su Blossom, oppure incolla l’indirizzo di una immagine già online."
        />

        <BaseField
          v-slot="{ id, describedBy }"
          label="Partecipanti"
          hint="Chiavi pubbliche esadecimali, separate da spazio o virgola."
        >
          <BaseInput :id="id" v-model="partecipanti" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Hashtag"
          hint="Uno alla volta: «Invio» lo aggiunge. Quelli letti da un evento di un altro client restano come li ha scritti."
        >
          <div class="flex flex-col gap-2">
            <ul v-if="hashtag.length" class="flex flex-wrap gap-2">
              <li
                v-for="h in hashtag"
                :key="h"
                class="superficie flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
              >
                <span>{{ h }}</span>
                <button
                  type="button"
                  class="text-xs underline"
                  :aria-label="`Togli ${h}`"
                  @click="togliHashtag(h)"
                >
                  ×
                </button>
              </li>
            </ul>
            <div class="flex flex-wrap items-center gap-2">
              <div class="min-w-48 flex-1">
                <BaseInput
                  :id="id"
                  v-model="nuovoHashtag"
                  :described-by="describedBy"
                  placeholder="bitcoin"
                  @keydown.enter.prevent="aggiungiHashtag"
                />
              </div>
              <BaseButton size="sm" :disabled="!nuovoHashtag.trim()" @click="aggiungiHashtag">
                Aggiungi
              </BaseButton>
            </div>
          </div>
        </BaseField>

        <EventTagAggiuntivi
          v-model="tagExtra"
          :nomi-del-form="nomiDelForm"
          :da-evento-esistente="modifica"
        />

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario" :disabled="!puoComporre">
            Componi evento
          </BaseButton>
          <ClientOnly>
            <template v-if="bozza.template.value && !bozza.pubblicato.value">
              <BaseButton
                variant="primario"
                :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
                :disabled="!identita.puoFirmare"
                @click="bozza.firmaEPubblica()"
              >
                {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
              </BaseButton>
              <BaseButton
                v-if="!bozza.firmato.value"
                variant="fantasma"
                :loading="bozza.inCorso.value"
                :disabled="!identita.puoFirmare"
                @click="bozza.firma()"
              >
                Solo firma
              </BaseButton>
            </template>
          </ClientOnly>
          <BaseButton v-if="bozza.template.value" variant="fantasma" @click="nuovo">
            Nuovo evento
          </BaseButton>
        </div>

        <ClientOnly>
          <p v-if="bozza.template.value" class="text-xs text-[var(--testo-tenue)]">
            Destinazione:
            <template v-for="(r, i) in bozza.invio.destinazioni.value" :key="r">
              <template v-if="i > 0">,</template>
              <code>{{ r }}</code>
            </template>
            — modificabili da
            <NuxtLink to="/impostazioni" class="underline">impostazioni</NuxtLink>
            .
          </p>
        </ClientOnly>

        <PublishProgress :invio="bozza.invio" />

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
      <PublishResult :esito="bozza.invio.esito.value" />
      <BaseAlert v-if="bozza.invio.esito.value.riuscita" tono="info" class="mt-3">
        <NuxtLink to="/calendario" class="underline">Vai al calendario</NuxtLink>
        per rileggerlo dai relay. Se non compare subito, il relay può metterci qualche istante a
        renderlo interrogabile.
      </BaseAlert>
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
