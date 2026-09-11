<script setup lang="ts">
import {
  attendiLavoro,
  estensioneDi,
  formatoDaNome,
  type FormatoAudio,
  type MediaProdotto,
  type StatoLavoro,
} from '@nmc/nostr-core'
import { useMediaManager } from '~/stores/mediamanager'

useHead({ title: 'Audio · NostrMediaClient' })

const servizio = useMediaManager()

// La configurazione del servizio sta nelle impostazioni, con gli altri
// endpoint: qui si controlla soltanto che risponda, per poterlo dire prima che
// l'utente scelga un file e scopra il guasto a meta' strada.
onMounted(() => servizio.verifica())

/*
 * Pre-elaborazione: quello che succede *prima* di pubblicare.
 *
 * La pagina si ferma allo scaricamento. Non carica su Blossom e non pubblica
 * eventi: e' una scelta, non una funzione mancante, e la pagina lo dice —
 * altrove nel client il passo dopo c'e' sempre, e la sua assenza qui
 * sorprenderebbe.
 */

// ─── 1. Il file ────────────────────────────────────────────────────────────
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
 * Soglia in decibel, come numero: l'unita' la mette il servizio.
 *
 * Prima andava composta qui (`-40dB`) perche' il servizio la pretendeva nella
 * stringa, e ometterla significava passare un'ampiezza lineare — cioe' non
 * tagliare nulla, senza che nulla lo dicesse.
 */
const sogliaDb = ref(-40)
const durataMinimaS = ref(1)
const formatoUscita = ref<FormatoAudio>('audio/mpeg')

watch(formato, (f) => {
  if (!f) return
  // Un wav resta un wav se non si chiede altro; per il resto l'mp3 e' il
  // formato con cui un episodio si pubblica.
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
const durataRisultato = ref<number | null>(null)

function azzeraRisultato(): void {
  if (urlRisultato.value) URL.revokeObjectURL(urlRisultato.value)
  urlRisultato.value = null
  nomeRisultato.value = null
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

  /** Aspetta un lavoro e restituisce l'unico file che ha prodotto. */
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

    // Il riferimento e' il `filename` che risponde il servizio, non il titolo
    // che gli abbiamo mandato: sono due campi diversi, e il secondo non
    // risolve.
    let riferimento: string | number = caricato.filename
    let prodotto: MediaProdotto | null = null

    /*
     * Prima i silenzi, poi il livellamento.
     *
     * L'ordine non e' piu' imposto dal servizio — ogni operazione accetta
     * qualunque riferimento — ma resta la scelta giusta: livellando per primo,
     * l'amplificazione alza il rumore di fondo sopra la soglia e i silenzi non
     * vengono piu' riconosciuti.
     */
    if (vuoiSilenzi.value) {
      fase.value = 'Accorcio i silenzi…'
      prodotto = await attendi(
        await s.avviaSilenzi(riferimento, {
          sogliaDb: sogliaDb.value,
          pausaMinimaS: durataMinimaS.value,
          // Senza livellamento dopo, questo e' gia' il file finale: va
          // consegnato nel formato scelto invece che nel wav intermedio.
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

/** Sigla del formato scelto, per l'etichetta accanto al nome del file. */
const estensioneCorrente = computed(() => (formato.value ? estensioneDi(formato.value) : ''))

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
      <!-- ─────────── Il servizio, solo se c'è qualcosa da dire ─────────── -->
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
        Due guasti diversi, due frasi diverse: se non risponde *nessun* dominio
        la causa e' quasi sempre CORS o l'indirizzo, non l'audio — e dire
        «manca l'audio» manderebbe a cercare il problema dove non e'.
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

      <!-- ─────────── 1. Il file ─────────── -->
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
            I cursori stanno qui, non nella sezione avanzata: sono la
            regolazione che cambia il risultato, e il valore giusto dipende
            dalla registrazione. Un campo di testo li farebbe scegliere alla
            cieca, perche' la scala dei decibel non e' d'uso comune.
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

          <div>
            <BaseButton variant="primario" @click="scarica">Scarica</BaseButton>
          </div>

          <BaseAlert tono="info">
            Qui il percorso finisce. Il file elaborato è nel tuo browser e non è stato caricato da
            nessuna parte: se vuoi pubblicarlo, scaricalo e caricalo dalla sezione Media.
          </BaseAlert>
        </div>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
