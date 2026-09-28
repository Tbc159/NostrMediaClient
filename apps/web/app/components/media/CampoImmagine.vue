<script setup lang="ts">
import { listBlobs, uploadBlob, type BlobDescriptor } from '@nmc/nostr-core'

/**
 * Campo «immagine»: un indirizzo, ma senza dover andare a prenderlo altrove.
 *
 * L'indirizzo da solo bastava a pubblicare, non a lavorare: chi non ha il
 * link pronto doveva aprire la sezione media, caricare il file, copiare
 * l'URL e tornare qui. Tre passaggi per una cosa che sta in uno. Qui il file
 * si carica da dove serve, e quelle gia' su Blossom si scelgono da un
 * elenco — perche' «una foto che ho gia' caricato» e' il caso piu' comune,
 * non quello raro.
 *
 * Nessun vincolo di forma: al contrario della copertina di un podcast, che le
 * piattaforme pretendono quadrata, per un articolo NIP-23 non dice nulla e
 * imporre un ritaglio sarebbe una regola inventata da noi.
 *
 * L'elenco arriva da Blossom (BUD-12), non dai propri eventi: comprende anche
 * i file caricati e non ancora pubblicati, che sono proprio quelli che si sta
 * cercando. Alcuni server chiedono un'autorizzazione firmata per elencare, e
 * `listBlobs` la chiede solo quando il server la pretende.
 */

withDefaults(
  defineProps<{
    label: string
    hint?: string
    required?: boolean
  }>(),
  { hint: undefined, required: false },
)

const url = defineModel<string>({ default: '' })

const identita = useIdentity()
const config = useClientConfig()
const server = computed(() => config.value.blossomServers)
const puoCaricare = computed(() => identita.puoFirmare && server.value.length > 0)

// ── Caricamento ───────────────────────────────────────────────────────────
const inCorso = ref(false)
const errore = ref<string | null>(null)

async function carica(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  const destinazione = server.value[0]
  if (!destinazione || !identita.puoFirmare) return

  inCorso.value = true
  errore.value = null
  try {
    const descrittore = await uploadBlob(destinazione, file, {
      firma: (t) => identita.firma(t),
      pubkey: identita.pubkey ?? '',
      mime: file.type || 'application/octet-stream',
      nome: file.name,
    })
    url.value = descrittore.url
    // Appena caricata, deve comparire anche nell'elenco: si rilegge alla
    // prossima apertura, ma intanto la si aggiunge in testa.
    if (elenco.value) elenco.value = [descrittore, ...elenco.value]
  } catch (e) {
    errore.value = `Immagine non caricata: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    inCorso.value = false
  }
}

// ── Elenco di quelle gia' su Blossom ──────────────────────────────────────
const galleriaAperta = ref(false)
const elenco = ref<BlobDescriptor[] | null>(null)
const elencoInCorso = ref(false)
/** Un messaggio per server che non ha risposto: meglio dirlo che mostrare meno file senza spiegare. */
const problemiElenco = ref<string[]>([])

async function leggiElenco(): Promise<void> {
  if (!identita.pubkey) return
  elencoInCorso.value = true
  problemiElenco.value = []
  try {
    const risultati = await Promise.all(
      server.value.map(async (s) => {
        try {
          return await listBlobs(s, identita.pubkey as string, {
            ...(identita.puoFirmare ? { firma: (t) => identita.firma(t) } : {}),
            ...(identita.pubkey ? { pubkeyFirma: identita.pubkey } : {}),
          })
        } catch (e) {
          problemiElenco.value.push(
            `${new URL(s).host}: ${e instanceof Error ? e.message : String(e)}`,
          )
          return [] as BlobDescriptor[]
        }
      }),
    )
    // Solo immagini, le piu' recenti prima, senza doppioni fra server (lo
    // stesso file replicato su due server ha lo stesso hash).
    const viste = new Set<string>()
    elenco.value = risultati
      .flat()
      .filter((b) => b.type?.startsWith('image/'))
      .sort((a, b) => (b.uploaded ?? 0) - (a.uploaded ?? 0))
      .filter((b) => !viste.has(b.sha256) && viste.add(b.sha256))
  } finally {
    elencoInCorso.value = false
  }
}

async function apriGalleria(): Promise<void> {
  galleriaAperta.value = !galleriaAperta.value
  if (galleriaAperta.value && elenco.value === null) await leggiElenco()
}

const scegli = (b: BlobDescriptor): void => {
  url.value = b.url
  galleriaAperta.value = false
}

const pesoLeggibile = (byte: number | undefined): string =>
  byte === undefined
    ? ''
    : byte > 1024 * 1024
      ? `${(byte / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(byte / 1024)} kB`
</script>

<template>
  <div class="flex flex-col gap-2">
    <BaseField v-slot="{ id, describedBy }" :label="label" :hint="hint" :required="required">
      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <BaseInput
            :id="id"
            v-model="url"
            placeholder="https://…/immagine.jpg"
            :described-by="describedBy"
          />
        </div>
        <label
          class="superficie cursor-pointer rounded-md border px-3 py-2 text-sm"
          :class="!puoCaricare || inCorso ? 'opacity-50' : ''"
        >
          {{ inCorso ? 'Carico…' : 'Carica un’immagine' }}
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            :disabled="!puoCaricare || inCorso"
            @change="carica"
          />
        </label>
        <BaseButton size="sm" :disabled="!identita.pubkey" @click="apriGalleria">
          {{ galleriaAperta ? 'Chiudi l’elenco' : 'Scegli fra le tue' }}
        </BaseButton>
      </div>

      <div v-if="url.trim()" class="mt-2 flex flex-wrap items-center gap-3">
        <img :src="url" alt="" class="h-24 w-40 rounded-md border object-cover" />
        <button type="button" class="text-xs underline" @click="url = ''">togli l’immagine</button>
      </div>
    </BaseField>

    <BaseAlert v-if="errore" tono="pericolo">{{ errore }}</BaseAlert>

    <!-- ── L'elenco di quelle gia' caricate ── -->
    <div v-if="galleriaAperta" class="superficie flex flex-col gap-3 rounded-md border p-3">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-medium">Le tue immagini su Blossom</p>
        <BaseBadge v-if="elencoInCorso">leggo…</BaseBadge>
        <BaseBadge v-else-if="elenco">{{ elenco.length }}</BaseBadge>
        <BaseButton
          size="sm"
          variant="fantasma"
          :loading="elencoInCorso"
          class="ml-auto"
          @click="leggiElenco"
        >
          Aggiorna
        </BaseButton>
      </div>

      <ul v-if="elenco?.length" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <li v-for="b in elenco" :key="b.sha256">
          <button
            type="button"
            class="superficie w-full overflow-hidden rounded-md border text-left"
            :class="b.url === url ? 'border-[var(--accento)]' : ''"
            @click="scegli(b)"
          >
            <img :src="b.url" alt="" loading="lazy" class="h-24 w-full object-cover" />
            <span class="block px-2 py-1 text-[0.7rem] text-[var(--testo-tenue)]">
              {{ b.type?.replace('image/', '') }} · {{ pesoLeggibile(b.size) }}
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="!elencoInCorso" class="text-sm text-[var(--testo-tenue)]">
        Nessuna immagine su Blossom per questa chiave. «Carica un’immagine» la mette lì e la usa
        subito.
      </p>

      <ul
        v-if="problemiElenco.length"
        class="flex flex-col gap-1 text-xs text-[var(--testo-tenue)]"
      >
        <li v-for="p in problemiElenco" :key="p">{{ p }}</li>
      </ul>
    </div>

    <p v-if="!puoCaricare" class="text-xs text-[var(--testo-tenue)]">
      Per caricare serve una chiave che firmi e un server Blossom nelle impostazioni. L’indirizzo di
      un’immagine già online si può incollare comunque.
    </p>
  </div>
</template>
