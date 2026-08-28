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

const identita = useIdentity()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const rotta = useRoute()

/** Vero quando si sta riaprendo un evento gia' pubblicato. */
const modifica = ref(false)

useHead({
  title: () => (modifica.value ? 'Modifica evento' : 'Nuovo evento') + ' · NostrMediaClient',
})

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

onMounted(async () => {
  // Il fuso del dispositivo si legge solo nel browser: in SSR darebbe quello
  // del server, che non c'entra nulla con l'utente.
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
 * Riapre un evento pubblicato.
 *
 * L'identificatore **non** viene rigenerato: e' il tag `d`, ed e' cio' che fa
 * di questa una sostituzione invece che di un evento nuovo. Cambiarlo qui
 * lascerebbe in giro l'originale e ne creerebbe un secondo.
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
    hashtag.value = dati.hashtags.join(' ')

    if (kind === 31922) {
      dataInizio.value = dati.start
      conFine.value = dati.end !== undefined
      if (dati.end) dataFine.value = dati.end
      return
    }

    // Il timestamp e' un istante assoluto: per rimetterlo nei campi data e ora
    // va riportato nel fuso dichiarato dall'evento, non in quello di chi
    // modifica. Altrimenti riaprendo da Roma una riunione fissata a Tokyo si
    // vedrebbe un orario diverso da quello che l'organizzatore aveva scritto.
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
  modifica.value = false
  esistente.errore.value = null
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
            <template v-if="bozza.template.value">
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
