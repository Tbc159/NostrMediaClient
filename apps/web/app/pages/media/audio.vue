<script setup lang="ts">
import {
  attendiLavoro,
  estensioneDi,
  formatoDaNome,
  type FormatoAudio,
  type MediaProdotto,
  type StatoLavoro,
} from '@nmc/nostr-core'
import { useConsegna } from '~/stores/consegna'
import { useMediaManager } from '~/stores/mediamanager'

useHead({ title: 'Audio · NostrMediaClient' })

const servizio = useMediaManager()
const consegna = useConsegna()

// The service's configuration lives in the settings, with the other
// endpoints: here it is only checked that it answers, so it can be said before
// the user chooses a file and finds the fault half way.
onMounted(() => servizio.verifica())

/*
 * Pre-processing: what happens *before* publishing.
 *
 * This page does not upload to Blossom and does not publish events: at the end
 * it offers two equal exits — download the file, or hand it to «Upload to
 * Blossom» in podcast mode already. The next step exists, but it is another
 * page with its own decisions; here only what the audio is like is decided.
 */

// ─── 1. The file ───────────────────────────────────────────────────────────
const file = ref<File | null>(null)
const urlOriginale = ref<string | null>(null)
const durataOriginale = ref<number | null>(null)
const erroreFile = ref<string | null>(null)

const formato = computed<FormatoAudio | null>(() =>
  file.value ? formatoDaNome(file.value.name) : null,
)

function scegli(evento: Event): void {
  const target = evento.target as HTMLInputElement
  const scelto = target.files?.[0]
  target.value = ''
  if (!scelto) return

  erroreFile.value = null
  if (!formatoDaNome(scelto.name)) {
    erroreFile.value = `Il servizio tratta mp3, m4a e wav. «${scelto.name}» non è fra questi.`
    return
  }

  azzeraRisultato()
  if (urlOriginale.value) URL.revokeObjectURL(urlOriginale.value)
  file.value = scelto
  urlOriginale.value = URL.createObjectURL(scelto)
  durataOriginale.value = null
}

function annotaDurata(evento: Event): void {
  const el = evento.target as HTMLAudioElement
  if (Number.isFinite(el.duration)) durataOriginale.value = el.duration
}

// ─── 2. Cosa fare ──────────────────────────────────────────────────────────
const vuoiSilenzi = ref(true)
const vuoiLivellare = ref(true)
/**
 * The threshold in decibels, as a number: the service adds the unit.
 *
 * It used to have to be composed here (`-40dB`) because the service demanded
 * it in the string, and leaving it out meant passing a linear amplitude — that
 * is, cutting nothing, with nothing to say so.
 */
const sogliaDb = ref(-40)
const durataMinimaS = ref(1)
const formatoUscita = ref<FormatoAudio>('audio/mpeg')

watch(formato, (f) => {
  if (!f) return
  // A wav stays a wav when nothing else is asked for; for the rest the mp3 is
  // the format an episode is published in.
  formatoUscita.value = f === 'audio/wav' ? 'audio/wav' : 'audio/mpeg'
})

const nienteDaFare = computed(() => !vuoiSilenzi.value && !vuoiLivellare.value)

// ─── 3. Avanzamento ────────────────────────────────────────────────────────
const inCorso = ref(false)
const fase = ref<string | null>(null)
const trascorsoS = ref(0)
const erroreLavoro = ref<string | null>(null)
let interruzione: AbortController | null = null

// ─── 4. Risultato ──────────────────────────────────────────────────────────
const urlRisultato = ref<string | null>(null)
const nomeRisultato = ref<string | null>(null)
/** The bytes, not just the URL: handing them to the next page needs them. */
const byteRisultato = shallowRef<Blob | null>(null)
const durataRisultato = ref<number | null>(null)

function azzeraRisultato(): void {
  if (urlRisultato.value) URL.revokeObjectURL(urlRisultato.value)
  urlRisultato.value = null
  nomeRisultato.value = null
  byteRisultato.value = null
  durataRisultato.value = null
  erroreLavoro.value = null
  fase.value = null
}

onBeforeUnmount(() => {
  if (urlOriginale.value) URL.revokeObjectURL(urlOriginale.value)
  if (urlRisultato.value) URL.revokeObjectURL(urlRisultato.value)
  interruzione?.abort()
})

function interrompi(): void {
  interruzione?.abort()
}

async function elabora(): Promise<void> {
  const s = servizio.audio
  const sorgente = file.value
  const suo = formato.value
  if (!s || !sorgente || !suo) return

  azzeraRisultato()
  inCorso.value = true
  interruzione = new AbortController()
  const inizio = Date.now()
  const cronometro = setInterval(() => (trascorsoS.value = (Date.now() - inizio) / 1000), 200)

  const segui = (stato: StatoLavoro): void => {
    if (stato.stato !== 'completato') trascorsoS.value = (Date.now() - inizio) / 1000
  }

  /** Waits for a job and returns the only file it produced. */
  const attendi = async (idLavoro: string): Promise<MediaProdotto> => {
    const prodotti = await attendiLavoro(s, idLavoro, {
      segnale: interruzione?.signal as AbortSignal,
      onStato: segui,
    })
    return prodotti[0] as MediaProdotto
  }

  try {
    fase.value = 'Invio il file al servizio…'
    const caricato = await s.carica(sorgente, sorgente.name, suo)

    // The reference is the `filename` the service answers with, not the title
    // we sent it: they are two different fields, and the second does not
    // resolve.
    let riferimento: string | number = caricato.filename
    let prodotto: MediaProdotto | null = null

    /*
     * The silences first, then the levelling.
     *
     * The order is no longer imposed by the service — every operation accepts
     * any reference — but it remains the right choice: levelling first, the
     * amplification lifts the background noise above the threshold and the
     * silences are no longer recognised.
     */
    if (vuoiSilenzi.value) {
      fase.value = 'Accorcio i silenzi…'
      prodotto = await attendi(
        await s.avviaSilenzi(riferimento, {
          sogliaDb: sogliaDb.value,
          pausaMinimaS: durataMinimaS.value,
          // With no levelling afterwards, this is the final file already: it
          // has to be handed over in the chosen format and not the intermediate wav.
          ...(vuoiLivellare.value ? {} : { formato: formatoUscita.value }),
        }),
      )
      riferimento = prodotto.id
    }

    if (vuoiLivellare.value) {
      fase.value = 'Livello le voci…'
      prodotto = await attendi(
        await s.avviaLivellamento(riferimento, { formato: formatoUscita.value }),
      )
    }

    if (!prodotto) return

    fase.value = 'Recupero il risultato…'
    const byte = await s.scarica(prodotto)
    byteRisultato.value = byte
    urlRisultato.value = URL.createObjectURL(byte)
    nomeRisultato.value = `${nomeSenzaEstensione(sorgente.name)}-elaborato.${estensioneDi(formatoUscita.value)}`
    fase.value = null
  } catch (e) {
    erroreLavoro.value = e instanceof Error ? e.message : String(e)
    fase.value = null
  } finally {
    clearInterval(cronometro)
    inCorso.value = false
    interruzione = null
  }
}

const nomeSenzaEstensione = (nome: string): string => nome.replace(/\.[^.]+$/, '')

/** The short form of the chosen format, for the label beside the file's name. */
const estensioneCorrente = computed(() => (formato.value ? estensioneDi(formato.value) : ''))

/**
 * Hands the processed file to «Upload to Blossom», in podcast mode already.
 *
 * The `Blob` travels in memory, not in a query string: the next page collects
 * it when it opens as though the user had chosen it from disk.
 */
function pubblicaComePodcast(): void {
  if (!byteRisultato.value || !nomeRisultato.value) return
  const file = new File([byteRisultato.value], nomeRisultato.value, {
    type: formatoUscita.value,
  })
  consegna.deposita(file, 'audio')
  void navigateTo('/media/podcast')
}

function scarica(): void {
  if (!urlRisultato.value || !nomeRisultato.value) return
  const a = document.createElement('a')
  a.href = urlRisultato.value
  a.download = nomeRisultato.value
  a.click()
}

const durataLeggibile = (s: number | null): string =>
  s === null ? '—' : `${Math.floor(s / 60)}′${String(Math.round(s % 60)).padStart(2, '0')}″`

const pesoLeggibile = (b: number): string =>
  b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} kB` : `${(b / (1024 * 1024)).toFixed(1)} MB`
</script>

<template>
  <div class="flex flex-col gap-6">
    <MediaSchede />

    <header class="flex flex-col gap-2">
      <h1 class="text-xl font-semibold tracking-tight">Audio</h1>
      <p class="text-sm text-[var(--testo-tenue)]">
        Prepara una registrazione prima di pubblicarla: togli le pause morte, porta le voci allo
        stesso volume, riascolta.
        <strong>Il file resta qui</strong>
        : questa pagina non carica nulla su Blossom e non pubblica eventi.
      </p>
    </header>

    <ClientOnly>
      <!-- ─────────── The service, only when there is something to say ─────────── -->
      <BaseAlert v-for="(o, i) in servizio.ostacoli" :key="i" tono="pericolo">
        {{ o }}
      </BaseAlert>

      <BaseAlert v-if="!servizio.configurato" tono="avviso">
        Nessun servizio di elaborazione configurato: senza, questa pagina non può fare nulla.
        <NuxtLink to="/impostazioni" class="underline">
          Impostazioni → Servizio di elaborazione
        </NuxtLink>
      </BaseAlert>

      <!--
        Two different faults, two different sentences: when *no* domain answers
        the cause is nearly always CORS or the address, not the audio — and
        saying «the audio is missing» would send you looking for the problem
        where it is not.
      -->
      <BaseAlert
        v-else-if="servizio.salute && !servizio.salute.media && !servizio.salute.audio"
        tono="avviso"
      >
        <strong>Il servizio non risponde</strong>
        , su nessun dominio. Dal browser la causa più frequente non è il servizio spento: se questa
        origine non è fra quelle ammesse dal suo CORS, la richiesta viene bloccata prima di partire
        e qui si vede così. Con curl risponderebbe.
        <NuxtLink to="/impostazioni" class="underline">Controlla indirizzo e chiave</NuxtLink>
      </BaseAlert>

      <BaseAlert v-else-if="servizio.salute && !servizio.salute.audio" tono="avviso">
        Il servizio risponde ma
        <strong>non espone il dominio audio</strong>
        : il file lo puoi scegliere e riascoltare, ma l’elaborazione fallirà. È l’ambiente a non
        averlo ancora, non una configurazione sbagliata.
        <NuxtLink to="/impostazioni" class="underline">Controlla il servizio</NuxtLink>
      </BaseAlert>

      <!-- ─────────── 1. The file ─────────── -->
      <BaseCard title="1 · Scegli il file" subtitle="Ascoltalo prima di mandarlo da qualche parte.">
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <label class="superficie cursor-pointer rounded-md border px-3.5 py-2 text-sm">
              Scegli un file audio
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" class="sr-only" @change="scegli" />
            </label>
            <span class="text-xs text-[var(--testo-tenue)]">mp3, m4a o wav</span>
          </div>

          <BaseAlert v-if="erroreFile" tono="pericolo">{{ erroreFile }}</BaseAlert>

          <div v-if="file && urlOriginale" class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <strong>{{ file.name }}</strong>
              <BaseBadge>{{ estensioneCorrente }}</BaseBadge>
              <span class="text-[var(--testo-tenue)]">
                {{ pesoLeggibile(file.size) }} · {{ durataLeggibile(durataOriginale) }}
              </span>
            </div>
            <audio :src="urlOriginale" controls class="w-full" @loadedmetadata="annotaDurata" />
          </div>
        </div>
      </BaseCard>

      <!-- ─────────── 2. Cosa fare ─────────── -->
      <BaseCard
        v-if="file"
        title="2 · Scegli cosa fare"
        subtitle="Due operazioni, nell’ordine che dà il risultato migliore."
      >
        <div class="flex flex-col gap-4">
          <label class="flex items-start gap-2 text-sm">
            <input v-model="vuoiSilenzi" type="checkbox" class="mt-1" />
            <span>
              Accorcia i silenzi
              <span class="block text-xs text-[var(--testo-tenue)]">
                Le pause si accorciano, non si azzerano: ne resta una udibile. Vale per mp3, m4a e
                wav allo stesso modo.
              </span>
            </span>
          </label>

          <!--
            The sliders are here, not in the advanced section: they are the
            adjustment that changes the result, and the right value depends on
            the recording. A text field would have them chosen blind, because
            the decibel scale is not in common use.
          -->
          <div v-if="vuoiSilenzi" class="ml-6 flex flex-col gap-4 border-l pl-4">
            <BaseField
              v-slot="{ id }"
              label="Quanto dev’essere silenzioso per essere tagliato"
              hint="Più a destra taglia anche le pause con un po’ di fruscìo; troppo a destra mangia le code delle parole."
            >
              <BaseRange
                :id="id"
                v-model="sogliaDb"
                :min="-60"
                :max="-20"
                :step="1"
                unita="dB"
                estremo-min="−60 · solo il silenzio vero"
                estremo-max="−20 · taglia molto"
              />
            </BaseField>

            <BaseField
              v-slot="{ id }"
              label="Quanto dev’essere lunga la pausa"
              hint="Sotto il mezzo secondo si tagliano anche i respiri fra una frase e l’altra."
            >
              <BaseRange
                :id="id"
                v-model="durataMinimaS"
                :min="0.2"
                :max="5"
                :step="0.1"
                unita="s"
                estremo-min="0,2s · anche i respiri"
                estremo-max="5s · solo le pause lunghe"
              />
            </BaseField>
          </div>

          <label class="flex items-start gap-2 text-sm">
            <input v-model="vuoiLivellare" type="checkbox" class="mt-1" />
            <span>
              Livella le voci
              <span class="block text-xs text-[var(--testo-tenue)]">
                Porta il parlato a un volume uniforme e il file a −16 LUFS.
              </span>
            </span>
          </label>

          <details class="superficie rounded-md border p-3">
            <summary class="cursor-pointer text-sm font-medium">Parametri</summary>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <BaseField v-slot="{ id }" label="Formato in uscita">
                <BaseSelect
                  :id="id"
                  v-model="formatoUscita"
                  :disabled="!vuoiLivellare"
                  :options="[
                    { value: 'audio/mpeg', label: 'mp3' },
                    { value: 'audio/wav', label: 'wav' },
                    { value: 'audio/m4a', label: 'm4a' },
                  ]"
                />
              </BaseField>
            </div>
          </details>

          <BaseAlert v-if="vuoiSilenzi && vuoiLivellare" tono="info">
            Prima i silenzi, poi il livellamento. Non è un vincolo del servizio ma una scelta di
            qualità: livellando per primo, l’amplificazione alza il rumore di fondo sopra la soglia
            e i silenzi non vengono più riconosciuti — su una prova, 56 secondi tolti contro 28.
          </BaseAlert>

          <div>
            <BaseButton
              variant="primario"
              :disabled="nienteDaFare || !servizio.configurato"
              :loading="inCorso"
              @click="elabora"
            >
              Avvia l’elaborazione
            </BaseButton>
          </div>
        </div>
      </BaseCard>

      <!-- ─────────── 3. Avanzamento ─────────── -->
      <BaseCard v-if="inCorso || erroreLavoro" title="3 · In lavorazione">
        <div class="flex flex-col gap-3">
          <p v-if="fase" class="flex items-center gap-2 text-sm">
            <span class="h-2 w-2 animate-pulse rounded-full bg-[var(--accento)]" />
            {{ fase }}
            <span class="text-[var(--testo-tenue)]">{{ trascorsoS.toFixed(0) }}s</span>
          </p>

          <BaseAlert v-if="erroreLavoro" tono="pericolo">{{ erroreLavoro }}</BaseAlert>

          <div v-if="inCorso">
            <BaseButton size="sm" variant="fantasma" @click="interrompi">
              Smetti di aspettare
            </BaseButton>
            <p class="mt-1 text-xs text-[var(--testo-tenue)]">
              Il lavoro può restare in corso sul servizio: qui si smette solo di attenderlo.
            </p>
          </div>
        </div>
      </BaseCard>

      <!-- ─────────── 4. Confronto ─────────── -->
      <BaseCard
        v-if="urlRisultato"
        title="4 · Confronta e scarica"
        subtitle="La differenza si sente: ascoltali uno dopo l’altro."
      >
        <div class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium">Originale</span>
              <audio :src="urlOriginale ?? ''" controls class="w-full" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium">Elaborato</span>
              <audio
                :src="urlRisultato"
                controls
                class="w-full"
                @loadedmetadata="(e) => (durataRisultato = (e.target as HTMLAudioElement).duration)"
              />
            </div>
          </div>

          <p class="text-sm text-[var(--testo-tenue)]">
            Durata: {{ durataLeggibile(durataOriginale) }} →
            {{ durataLeggibile(durataRisultato) }}
          </p>

          <!--
            Two equal exits: stop here taking the file away, or go on. Neither
            of the two uploads anything without another explicit step in the
            other page.
          -->
          <!--
            A wav as a podcast is a mistake you find out about only in the
            apps, which leave it mute: it is said here, where changing the
            output format and reprocessing is all it takes.
          -->
          <BaseAlert v-if="formatoUscita === 'audio/wav'" tono="avviso">
            Il risultato è un
            <strong>wav</strong>
            : va bene per lavorarci, non per un podcast — Apple, Spotify, Amazon e YouTube leggono
            solo mp3 e m4a. Se vuoi pubblicarlo come episodio, scegli
            <strong>mp3</strong>
            nei parametri e rielabora.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton variant="primario" @click="pubblicaComePodcast">
              Pubblica come podcast
            </BaseButton>
            <BaseButton @click="scarica">Scarica</BaseButton>
          </div>

          <BaseAlert tono="info">
            Il file elaborato è nel tuo browser e non è stato caricato da nessuna parte. «Pubblica
            come podcast» lo porta nella scheda
            <strong>Podcast</strong>
            con l’episodio già impostato: il caricamento parte solo lì, quando lo chiedi tu.
            «Scarica» te lo dà e finisce qui.
          </BaseAlert>
        </div>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
