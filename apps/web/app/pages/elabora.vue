<script setup lang="ts">
import {
  portaDaIndirizzo,
  portaSulServizio,
  scaricaGenerata,
  urlPerAnteprima,
  uploadBlob,
  TIPI_ACCETTATI,
  type ImmagineGenerata,
  type Livello,
  type MediaItem,
  type RichiestaImmagine,
} from '@nmc/nostr-core'
import { useMediaManager } from '~/stores/mediamanager'

useHead({ title: 'Elabora · NostrMediaClient' })

const identita = useIdentity()
const servizio = useMediaManager()
const config = useClientConfigSafe()

// Indirizzo e chiave stanno nelle impostazioni, con gli altri endpoint: questa
// pagina mostra solo cosa il servizio sa fare. Qui si controlla che risponda,
// per dirlo prima che l'utente carichi un ingrediente.
onMounted(() => servizio.verifica())

/*
 * Due archivi che non si conoscono.
 *
 * Blossom conserva quello che pubblichi; il media-manager conserva gli
 * ingredienti e i prodotti dell'elaborazione. Un file caricato su Blossom non
 * e' automaticamente noto al servizio: i byte devono passare di la', ed e' il
 * primo passo di questa pagina invece di un dettaglio nascosto.
 */

// ─── Ingredienti ───────────────────────────────────────────────────────────
const ingredienti = ref<MediaItem[]>([])
const erroreIngrediente = ref<string | null>(null)
const caricamento = ref(false)
const indirizzoRemoto = ref('')

async function aggiungiLocale(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  // Un file sul disco di chi guarda nessun server può andarselo a prendere:
  // questi byte passano per forza dal browser.
  await aggiungi((client) =>
    portaSulServizio(client, { blob: file, titolo: file.name, mime: file.type }),
  )
}

async function aggiungiDaIndirizzo(): Promise<void> {
  const url = indirizzoRemoto.value.trim()
  if (!url) return
  // Il download lo fa il servizio: i byte non passano più da qui. Per un file
  // di decine di megabyte è la differenza fra due transiti e nessuno.
  const nome = url.split('/').pop()?.split('?')[0] || 'da-blossom'
  await aggiungi((client) => portaDaIndirizzo(client, { url, titolo: nome }))
  if (!erroreIngrediente.value) indirizzoRemoto.value = ''
}

async function aggiungi(
  porta: (client: NonNullable<typeof servizio.client>) => Promise<{ media: MediaItem }>,
): Promise<void> {
  const client = servizio.client
  if (!client) {
    erroreIngrediente.value = 'Servizio non configurato: l’indirizzo si imposta dalle impostazioni.'
    return
  }
  erroreIngrediente.value = null
  caricamento.value = true
  try {
    const esito = await porta(client)
    if (!ingredienti.value.some((m) => m.id === esito.media.id)) {
      ingredienti.value = [...ingredienti.value, esito.media]
    }
  } catch (e) {
    erroreIngrediente.value = e instanceof Error ? e.message : String(e)
  } finally {
    caricamento.value = false
  }
}

// ─── Composizione ──────────────────────────────────────────────────────────
type Modo = 'copertina' | 'composita'
const modo = ref<Modo>('copertina')

const titolo = ref('')
const testoCentrale = ref('')
const logoHost = ref('')
const coloreSfondo = ref('#ff751f')

/**
 * Livello nella forma che il form modifica.
 *
 * Tutti i campi in un tipo solo, invece dell'unione discriminata del
 * contratto: `v-model` ha bisogno di un bersaglio assegnabile, e con l'unione
 * ogni campo andrebbe raggiunto con un cast — che nei template Vue non e'
 * nemmeno un'espressione valida. La conversione alla forma del contratto
 * avviene una volta sola, quando si compone la richiesta.
 */
interface LivelloModificabile {
  type: Livello['type']
  content: string
  media: string
  fallback_color: string
  x: string
  y: string
  font_size: number
}

const nuovoLivello = (type: Livello['type']): LivelloModificabile => ({
  type,
  content: type === 'text' ? 'TESTO' : '',
  media: type === 'background' ? '' : (ingredienti.value[0]?.filename ?? ''),
  fallback_color: '#111111',
  x: 'center',
  y: type === 'person' ? 'bottom' : 'center',
  font_size: 90,
})

const livelli = ref<LivelloModificabile[]>([nuovoLivello('background')])

function aggiungiLivello(tipo: Livello['type']): void {
  livelli.value = [...livelli.value, nuovoLivello(tipo)]
}

function togliLivello(i: number): void {
  livelli.value = livelli.value.filter((_, k) => k !== i)
}

/** Dalla forma del form a quella del contratto, scartando i campi che non valgono per il tipo. */
function verso(l: LivelloModificabile): Livello {
  if (l.type === 'text') {
    return { type: 'text', content: l.content, font_size: l.font_size, x: l.x, y: l.y }
  }
  if (l.type === 'background') {
    return {
      type: 'background',
      ...(l.media ? { media: l.media } : {}),
      fallback_color: l.fallback_color,
    }
  }
  return { type: l.type, media: l.media, x: l.x, y: l.y }
}

/*
 * Il valore e' il `filename`, l'etichetta il `title`.
 *
 * Sono due campi diversi e solo il primo e' un riferimento: il `filename` lo
 * genera il servizio e va riletto dalla risposta del caricamento. Mandare il
 * titolo produce un 400 «asset non trovato», che è esattamente l'errore che
 * questa pagina faceva prima.
 */
const scelteAsset = computed(() => [
  { value: '', label: '— nessuna immagine —' },
  ...ingredienti.value.map((m) => ({ value: m.filename, label: m.title })),
])

const richiesta = computed<RichiestaImmagine | null>(() => {
  if (modo.value === 'copertina') {
    if (!titolo.value.trim() || !logoHost.value) return null
    return {
      tipo: 'copertina',
      titolo: titolo.value.trim(),
      testo_centrale: testoCentrale.value.trim(),
      logo_host: logoHost.value,
      colore_sfondo: coloreSfondo.value,
      ospiti: ingredienti.value
        .filter((m) => m.filename !== logoHost.value)
        .slice(0, 5)
        .map((m) => m.filename),
    }
  }
  return livelli.value.length ? { tipo: 'composita', layers: livelli.value.map(verso) } : null
})

// ─── Risultato ─────────────────────────────────────────────────────────────
const generata = ref<ImmagineGenerata | null>(null)
const anteprima = ref<string | null>(null)
/** L'object URL, quando serve: solo se il servizio non firma gli URL. */
const anteprimaLocale = ref<string | null>(null)
const blobGenerato = ref<Blob | null>(null)
const erroreGenerazione = ref<string | null>(null)
const generazioneInCorso = ref(false)

async function genera(): Promise<void> {
  const client = servizio.client
  const corpo = richiesta.value
  if (!client || !corpo) return

  erroreGenerazione.value = null
  generazioneInCorso.value = true
  try {
    generata.value = await client.generaImmagine(corpo)

    // L'anteprima usa il `signed_url`, che porta con sé un token a scadenza e
    // quindi funziona in un <img src> dove la chiave non si può mettere. I
    // byte si scaricano lo stesso, ma per il pulsante «Carica su Blossom»:
    // servono in mano, non solo a schermo.
    const firmato = urlPerAnteprima(client, generata.value)
    blobGenerato.value = await scaricaGenerata(client, generata.value)
    if (anteprimaLocale.value) URL.revokeObjectURL(anteprimaLocale.value)
    anteprimaLocale.value = firmato ? null : URL.createObjectURL(blobGenerato.value)
    anteprima.value = firmato ?? anteprimaLocale.value
  } catch (e) {
    erroreGenerazione.value = e instanceof Error ? e.message : String(e)
  } finally {
    generazioneInCorso.value = false
  }
}

onBeforeUnmount(() => {
  if (anteprimaLocale.value) URL.revokeObjectURL(anteprimaLocale.value)
})

function scarica(): void {
  const blob = blobGenerato.value
  if (!blob || !generata.value) return
  // Si scarica dai byte che abbiamo, non dall'URL firmato: quello scade, e un
  // pulsante che dopo qualche minuto salva una pagina di errore è peggio di un
  // pulsante che non c'è.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `generata-${generata.value.id}.${generata.value.media_type.split('/')[1]}`
  a.click()
  URL.revokeObjectURL(url)
}

const suBlossom = ref<string | null>(null)
const erroreBlossom = ref<string | null>(null)
const invioBlossom = ref(false)

async function mandaSuBlossom(): Promise<void> {
  const blob = blobGenerato.value
  const server = config.value.valore?.blossomServers[0]
  if (!blob || !server) return
  if (!identita.puoFirmare) {
    erroreBlossom.value = identita.motivoNonFirmabile ?? 'Serve una chiave che possa firmare.'
    return
  }
  erroreBlossom.value = null
  invioBlossom.value = true
  try {
    const descrittore = await uploadBlob(server, blob, {
      firma: (template) => identita.firma(template),
      pubkey: identita.pubkey ?? '',
      mime: generata.value?.media_type,
    })
    suBlossom.value = descrittore.url
  } catch (e) {
    erroreBlossom.value = e instanceof Error ? e.message : String(e)
  } finally {
    invioBlossom.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-2">
      <h1 class="text-xl font-semibold tracking-tight">Elabora</h1>
      <p class="text-sm text-[var(--testo-tenue)]">
        Un servizio esterno che compone immagini a partire da asset che gli dai. Non è Nostr e non è
        Blossom: tiene un archivio suo, quindi
        <strong>gli ingredienti vanno portati là</strong>
        prima di poterli usare. Il prodotto finito torna qui, e da qui puoi scaricarlo o pubblicarlo
        su Blossom.
      </p>
    </header>

    <ClientOnly>
      <!-- ─────────── Il servizio, solo se c'è qualcosa da dire ─────────── -->
      <BaseAlert v-for="(o, i) in servizio.ostacoli" :key="i" tono="pericolo">
        {{ o }}
      </BaseAlert>

      <BaseAlert v-if="!servizio.configurato" tono="avviso">
        Nessun servizio configurato: questa pagina non può fare nulla senza.
        <NuxtLink to="/impostazioni" class="underline">
          Impostazioni → Servizi di elaborazione
        </NuxtLink>
      </BaseAlert>

      <BaseAlert
        v-else-if="servizio.salute && !servizio.salute.media && !servizio.salute.content"
        tono="avviso"
      >
        Il servizio non risponde su nessuno dei due domini. Dal browser la causa più frequente non è
        il servizio spento: se non espone le intestazioni CORS, la richiesta viene bloccata prima di
        partire e qui si vede come «non raggiungibile».
        <NuxtLink to="/impostazioni" class="underline">Controlla indirizzo e chiave</NuxtLink>
      </BaseAlert>

      <!-- ─────────── 1. Ingredienti ─────────── -->
      <BaseCard
        v-if="servizio.configurato"
        title="1 · Porta gli ingredienti sul servizio"
        subtitle="Da un file locale, oppure da un indirizzo — per esempio un file già su Blossom."
      >
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <label class="superficie cursor-pointer rounded-md border px-3.5 py-2 text-sm">
              Scegli un file
              <input type="file" class="sr-only" @change="aggiungiLocale" />
            </label>
            <span class="text-xs text-[var(--testo-tenue)]">
              Tipi accettati: {{ TIPI_ACCETTATI.join(', ') }}
            </span>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-64 flex-1">
              <BaseField v-slot="{ id }" label="…oppure da un indirizzo">
                <BaseInput :id="id" v-model="indirizzoRemoto" placeholder="https://…/abcdef.png" />
              </BaseField>
            </div>
            <BaseButton :loading="caricamento" @click="aggiungiDaIndirizzo">
              Porta sul servizio
            </BaseButton>
          </div>

          <BaseAlert v-if="erroreIngrediente" tono="pericolo">{{ erroreIngrediente }}</BaseAlert>

          <ul v-if="ingredienti.length" class="flex flex-col gap-1 text-sm">
            <li
              v-for="m in ingredienti"
              :key="m.id"
              class="superficie flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <BaseBadge>id {{ m.id }}</BaseBadge>
              <strong>{{ m.title }}</strong>
              <span class="text-xs text-[var(--testo-tenue)]">{{ m.media_type }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-[var(--testo-tenue)]">Nessun ingrediente ancora.</p>
        </div>
      </BaseCard>

      <!-- ─────────── 2. Composizione ─────────── -->
      <BaseCard
        v-if="ingredienti.length"
        title="2 · Componi l’immagine"
        subtitle="Gli asset si indicano per nome file: il servizio li risolve nel suo archivio."
      >
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap gap-4">
            <!--
              `name` non e' decorativo: senza, il browser non tratta i due
              input come un gruppo — non si escludono a vicenda, le frecce
              della tastiera non li scorrono e uno screen reader non li
              annuncia come una scelta sola.
            -->
            <label class="flex items-center gap-2 text-sm">
              <input v-model="modo" type="radio" name="modo-composizione" value="copertina" />
              Copertina (2560×1440, template fisso)
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="modo" type="radio" name="modo-composizione" value="composita" />
              Composita (1920×1080, a livelli)
            </label>
          </div>

          <template v-if="modo === 'copertina'">
            <BaseField v-slot="{ id }" label="Titolo" required>
              <BaseInput :id="id" v-model="titolo" />
            </BaseField>
            <BaseField v-slot="{ id }" label="Testo centrale">
              <BaseInput :id="id" v-model="testoCentrale" />
            </BaseField>
            <BaseField
              v-slot="{ id }"
              label="Logo host"
              hint="Uno degli ingredienti caricati."
              required
            >
              <BaseSelect
                :id="id"
                v-model="logoHost"
                :options="ingredienti.map((m) => ({ value: m.title, label: m.title }))"
              />
            </BaseField>
            <BaseField v-slot="{ id }" label="Colore di sfondo">
              <BaseInput :id="id" v-model="coloreSfondo" placeholder="#ff751f" />
            </BaseField>
            <p class="text-xs text-[var(--testo-tenue)]">
              Gli altri ingredienti (fino a 5) vengono usati come avatar degli ospiti.
            </p>
          </template>

          <template v-else>
            <div v-for="(l, i) in livelli" :key="i" class="superficie rounded-md border p-3">
              <div class="mb-2 flex items-center gap-2">
                <BaseBadge>{{ i + 1 }}. {{ l.type }}</BaseBadge>
                <BaseButton size="sm" variant="fantasma" class="ml-auto" @click="togliLivello(i)">
                  Togli
                </BaseButton>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <BaseInput v-if="l.type === 'text'" v-model="l.content" placeholder="Testo" />
                <BaseSelect v-else v-model="l.media" :options="scelteAsset" />
                <BaseInput
                  v-if="l.type === 'background'"
                  v-model="l.fallback_color"
                  placeholder="#111111"
                />
                <BaseInput
                  v-if="l.type !== 'background'"
                  v-model="l.x"
                  placeholder="x: left/center/right/50%"
                />
                <BaseInput
                  v-if="l.type !== 'background'"
                  v-model="l.y"
                  placeholder="y: top/center/bottom/50%"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <BaseButton size="sm" @click="aggiungiLivello('text')">+ testo</BaseButton>
              <BaseButton size="sm" @click="aggiungiLivello('image')">+ immagine</BaseButton>
              <BaseButton size="sm" @click="aggiungiLivello('person')">+ persona</BaseButton>
            </div>
            <p class="text-xs text-[var(--testo-tenue)]">
              L’ordine è la profondità: il primo livello è lo sfondo, gli altri gli stanno sopra.
            </p>
          </template>

          <BaseAlert v-if="erroreGenerazione" tono="pericolo">{{ erroreGenerazione }}</BaseAlert>

          <div>
            <BaseButton
              variant="primario"
              :disabled="!richiesta"
              :loading="generazioneInCorso"
              @click="genera"
            >
              Genera l’immagine
            </BaseButton>
          </div>
        </div>
      </BaseCard>

      <!-- ─────────── 3. Risultato ─────────── -->
      <BaseCard
        v-if="generata"
        title="3 · Il risultato"
        subtitle="Scaricalo, o pubblicalo su Blossom."
      >
        <div class="flex flex-col gap-4">
          <BaseAlert v-if="generata.warnings?.length" tono="avviso">
            <ul class="list-inside list-disc">
              <li v-for="(w, i) in generata.warnings" :key="i">{{ w }}</li>
            </ul>
          </BaseAlert>

          <img
            v-if="anteprima"
            :src="anteprima"
            alt="Anteprima dell’immagine generata"
            class="max-w-full rounded-md border"
          />

          <div class="flex flex-wrap gap-2">
            <BaseButton @click="scarica">Scarica</BaseButton>
            <BaseButton
              variant="primario"
              :loading="invioBlossom"
              :disabled="!identita.puoFirmare"
              @click="mandaSuBlossom"
            >
              Carica su Blossom
            </BaseButton>
          </div>

          <BaseAlert v-if="erroreBlossom" tono="pericolo">{{ erroreBlossom }}</BaseAlert>
          <BaseAlert v-if="suBlossom" tono="successo">
            Su Blossom:
            <a
              :href="suBlossom"
              target="_blank"
              rel="noopener noreferrer"
              class="underline break-all"
            >
              {{ suBlossom }}
            </a>
            — da qui puoi pubblicarlo come evento dalla sezione Media.
          </BaseAlert>
        </div>
      </BaseCard>

      <!-- ─────────── Dove sta l'audio ─────────── -->
      <BaseCard title="E l’audio?" subtitle="Sta in una sezione sua.">
        <p class="text-sm text-[var(--testo-tenue)]">
          Normalizzazione e taglio dei silenzi si fanno nella sezione
          <NuxtLink to="/audio" class="underline">Audio</NuxtLink>
          , che parla con un servizio diverso: questo microservizio non espone ancora un dominio
          audio, e finché non lo espone le due cose restano separate. Cosa manca e in che forma è
          scritto in
          <code>doc/api-da-sviluppare.md</code>
          .
        </p>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
