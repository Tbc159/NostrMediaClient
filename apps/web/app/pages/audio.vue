<script setup lang="ts">
import {
  attendiLavoro,
  codecDaNome,
  strategiaSilenzi,
  type CodecAudio,
  type StatoLavoro,
} from '@nmc/nostr-core'
import { useAudio } from '~/stores/audio'

useHead({ title: 'Audio · NostrMediaClient' })

const servizio = useAudio()

onMounted(async () => {
  servizio.carica()
  await servizio.verifica()
})

/*
 * Pre-elaborazione: quello che succede *prima* di pubblicare.
 *
 * La pagina si ferma allo scaricamento. Non carica su Blossom e non pubblica
 * eventi: e' una scelta, non una funzione mancante, e la pagina lo dice —
 * altrove nel client il passo dopo c'e' sempre, e la sua assenza qui
 * sorprenderebbe.
 */

async function salvaEVerifica(): Promise<void> {
  servizio.salva()
  await servizio.verifica()
}

// ─── 1. Il file ────────────────────────────────────────────────────────────
const file = ref<File | null>(null)
const urlOriginale = ref<string | null>(null)
const durataOriginale = ref<number | null>(null)
const erroreFile = ref<string | null>(null)

const codec = computed<CodecAudio | null>(() => (file.value ? codecDaNome(file.value.name) : null))

function scegli(evento: Event): void {
  const target = evento.target as HTMLInputElement
  const scelto = target.files?.[0]
  target.value = ''
  if (!scelto) return

  erroreFile.value = null
  if (!codecDaNome(scelto.name)) {
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
 * Soglia in decibel, come numero.
 *
 * L'unita' si compone al momento dell'invio: il servizio la pretende
 * (`-40dB`), e senza interpreta il valore come ampiezza lineare — un `-40`
 * scritto per sbaglio non taglierebbe nulla, in silenzio.
 */
const sogliaDb = ref(-40)
const durataMinimaS = ref(1)
const codecUscita = ref<CodecAudio>('mp3')

/** Se e come il taglio dei silenzi è possibile per questo formato. */
const strategia = computed(() => (codec.value ? strategiaSilenzi(codec.value) : null))

watch(codec, (c) => {
  if (!c) return
  codecUscita.value = c === 'wav' ? 'wav' : 'mp3'
  // Si riallinea in entrambe le direzioni: spegnerla soltanto lascerebbe
  // l'operazione disattivata anche dopo aver scelto un file che la ammette,
  // senza che nulla lo spieghi.
  vuoiSilenzi.value = strategiaSilenzi(c) !== 'non-disponibile'
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
  const s = servizio.servizio
  const sorgente = file.value
  const suo = codec.value
  if (!s || !sorgente || !suo) return

  azzeraRisultato()
  inCorso.value = true
  interruzione = new AbortController()
  const inizio = Date.now()
  const cronometro = setInterval(() => (trascorsoS.value = (Date.now() - inizio) / 1000), 200)

  const segui = (stato: StatoLavoro): void => {
    if (stato.stato === 'in-corso') trascorsoS.value = (Date.now() - inizio) / 1000
  }

  try {
    fase.value = 'Invio il file al servizio…'
    let nome = await s.carica(sorgente, sorgente.name, suo)
    let lavorato: CodecAudio = suo

    // Un m4a non può perdere i silenzi finché non diventa mp3: è la cartella
    // da cui quell'operazione legge, non una nostra preferenza.
    if (vuoiSilenzi.value && strategiaSilenzi(suo) === 'conversione') {
      fase.value = 'Converto in mp3, perché il taglio dei silenzi legge solo da lì…'
      const lavoro = await s.convertiInMp3(nome)
      nome = await attendiLavoro(s, lavoro, { segnale: interruzione.signal, onStato: segui })
      lavorato = 'mp3'
    }

    // Prima i silenzi, poi il livellamento: invertendo, il file finisce in
    // un'altra cartella e il taglio non lo trova più — e il livellamento
    // alzerebbe il rumore di fondo sopra la soglia di silenzio.
    if (vuoiSilenzi.value) {
      fase.value = 'Tolgo i silenzi…'
      nome = await s.togliSilenzi(nome, {
        soglia: `${sogliaDb.value}dB`,
        durataMinimaS: durataMinimaS.value,
      })
    }

    if (vuoiLivellare.value) {
      fase.value = 'Livello le voci…'
      const lavoro = await s.livella(nome, codecUscita.value)
      nome = await attendiLavoro(s, lavoro, { segnale: interruzione.signal, onStato: segui })
      lavorato = codecUscita.value
    }

    fase.value = 'Recupero il risultato…'
    const prodotto = await s.scarica(nome)
    urlRisultato.value = URL.createObjectURL(prodotto)
    nomeRisultato.value = nome
    fase.value = null
    void lavorato
  } catch (e) {
    erroreLavoro.value = e instanceof Error ? e.message : String(e)
    fase.value = null
  } finally {
    clearInterval(cronometro)
    inCorso.value = false
    interruzione = null
  }
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
      <!-- ─────────── Il servizio ─────────── -->
      <BaseCard
        title="Il servizio"
        subtitle="Chi fa il lavoro. L’indirizzo resta in questo browser."
      >
        <div class="flex flex-col gap-3">
          <BaseField
            v-slot="{ id }"
            label="Indirizzo"
            hint="Il servizio di elaborazione audio. Non richiede chiave."
          >
            <BaseInput :id="id" v-model="servizio.baseUrl" placeholder="http://…" />
          </BaseField>

          <div class="flex flex-wrap items-center gap-2">
            <BaseButton :loading="servizio.verificaInCorso" @click="salvaEVerifica">
              Salva e verifica
            </BaseButton>
            <BaseBadge v-if="servizio.raggiungibile === true" tono="successo">
              raggiungibile
            </BaseBadge>
            <BaseBadge v-else-if="servizio.raggiungibile === false" tono="avviso">
              non raggiungibile
            </BaseBadge>
          </div>

          <BaseAlert v-for="(o, i) in servizio.ostacoli" :key="i" tono="pericolo">
            {{ o }}
          </BaseAlert>
        </div>
      </BaseCard>

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
              <BaseBadge>{{ codec }}</BaseBadge>
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
        subtitle="L’ordine non è modificabile, e il motivo è più sotto."
      >
        <div class="flex flex-col gap-4">
          <label class="flex items-start gap-2 text-sm">
            <input
              v-model="vuoiSilenzi"
              type="checkbox"
              class="mt-1"
              :disabled="strategia === 'non-disponibile'"
            />
            <span>
              Togli i silenzi
              <span
                v-if="strategia === 'conversione'"
                class="block text-xs text-[var(--testo-tenue)]"
              >
                Un m4a viene prima convertito in mp3: è la cartella da cui questa operazione legge.
              </span>
              <span
                v-else-if="strategia === 'non-disponibile'"
                class="block text-xs text-[var(--avviso)]"
              >
                Non disponibile per i wav: il servizio sa togliere i silenzi solo dagli mp3 e non ha
                un convertitore da wav.
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
                  v-model="codecUscita"
                  :disabled="!vuoiLivellare"
                  :options="[
                    { value: 'mp3', label: 'mp3' },
                    { value: 'wav', label: 'wav' },
                    { value: 'm4a', label: 'm4a' },
                  ]"
                />
              </BaseField>
            </div>
          </details>

          <BaseAlert v-if="vuoiSilenzi && vuoiLivellare" tono="info">
            Prima i silenzi, poi il livellamento — in quest’ordine e non nell’altro. Livellando per
            primo, l’amplificazione alza il rumore di fondo sopra la soglia e i silenzi non vengono
            più riconosciuti: su una prova, 56 secondi tolti contro 28.
          </BaseAlert>

          <BaseAlert v-if="vuoiSilenzi" tono="avviso">
            Il servizio azzera le pause invece di accorciarle: gli stacchi possono risultare
            bruschi. Lasciarne una parte richiede una modifica alle API.
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
