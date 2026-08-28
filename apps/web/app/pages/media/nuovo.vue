<script setup lang="ts">
import { getKindDefinition } from '@nmc/nostr-core'

useHead({ title: 'Carica media · NostrMediaClient' })

const identita = useIdentity()
const upload = useUpload()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const rotta = useRoute()

/** Vero quando si sta ricomponendo un evento a partire da uno gia' pubblicato. */
const daPrecedente = ref(false)

const titolo = ref('')
const descrizione = ref('')
const hashtag = ref('')
const avvisoContenuto = ref('')
const conAvviso = ref(false)

/**
 * Kind con cui pubblicare.
 *
 * Non e' una preferenza estetica: cambia chi vedra' il post. Un client
 * picture-first filtra per kind 20 e non mostrera' mai un 1063, e viceversa un
 * client di file non impagina gallerie.
 */
type Formato = 'immagini' | 'video' | 'video-corto' | 'file'
const formato = ref<Formato>('immagini')

const formati: { id: Formato; kind: number; etichetta: string; nota: string }[] = [
  {
    id: 'immagini',
    kind: 20,
    etichetta: 'Galleria di immagini',
    nota: 'Kind 20. Le immagini sono il contenuto, non un allegato al testo.',
  },
  {
    id: 'video',
    kind: 21,
    etichetta: 'Video',
    nota: 'Kind 21. Per video orizzontali e di durata piena.',
  },
  {
    id: 'video-corto',
    kind: 22,
    etichetta: 'Video corto',
    nota: 'Kind 22. Per gli short verticali. La distinzione è di formato, non tecnica.',
  },
  {
    id: 'file',
    kind: 1063,
    etichetta: 'Scheda file',
    nota: 'Kind 1063. Una scheda per ciascun file, interrogabile per hash.',
  },
]

const kindScelto = computed(() => formati.find((f) => f.id === formato.value)?.kind ?? 20)

const listaHashtag = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

const nessunFile = computed(() => upload.caricati.value.length === 0)

/** Suggerisce il formato in base a cosa e' stato caricato per primo. */
watch(
  () => upload.caricati.value.length,
  () => {
    const primo = upload.caricati.value[0]
    if (!primo) return
    const mime = primo.imeta.mime ?? ''
    if (mime.startsWith('image/')) formato.value = 'immagini'
    else if (mime.startsWith('video/')) formato.value = 'video'
    else formato.value = 'file'
  },
)

const inputFile = ref<HTMLInputElement | null>(null)

async function scegliFile(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  if (!target.files?.length) return
  await upload.caricaTutti(target.files)
  // Azzerare il campo permette di ricaricare due volte lo stesso file, che
  // altrimenti non genererebbe alcun evento `change`.
  target.value = ''
}

const trascinamento = ref(false)
async function rilascia(evento: DragEvent): Promise<void> {
  trascinamento.value = false
  const files = evento.dataTransfer?.files
  if (files?.length) await upload.caricaTutti(files)
}

function componi(): void {
  const definizione = getKindDefinition(kindScelto.value)
  if (!definizione) {
    bozza.errore.value = `Kind ${kindScelto.value} non registrato.`
    return
  }

  const media = upload.caricati.value
  const comune = {
    ...(listaHashtag.value.length ? { hashtags: listaHashtag.value } : {}),
    ...(conAvviso.value && avvisoContenuto.value.trim()
      ? { contentWarning: avvisoContenuto.value.trim() }
      : {}),
  }

  if (kindScelto.value === 20) {
    bozza.costruisci(definizione, {
      content: descrizione.value.trim(),
      ...(titolo.value.trim() ? { title: titolo.value.trim() } : {}),
      images: media.map((m) => m.imeta),
      ...comune,
    })
    return
  }

  if (kindScelto.value === 21 || kindScelto.value === 22) {
    bozza.costruisci(definizione, {
      content: descrizione.value.trim(),
      title: titolo.value.trim(),
      variants: media.map((m) => m.imeta),
      ...comune,
    })
    return
  }

  // 1063: una scheda per file. Si compone la prima e si dice quante restano,
  // invece di fingere che un solo evento le contenga tutte.
  const primo = media[0]
  if (!primo) return
  bozza.costruisci(definizione, {
    content: descrizione.value.trim(),
    ...primo.imeta,
    ...(primo.imeta.alt ? { alt: primo.imeta.alt } : {}),
  })
}

/**
 * Ricompone un evento media partendo da uno gia' pubblicato.
 *
 * Non e' una modifica e il form lo dice: i kind media sono **regolari**, quindi
 * immutabili come una nota. Quello che si ottiene e' un evento nuovo, con id
 * nuovo e senza le reazioni ricevute dall'originale.
 *
 * I file pero' non si ricaricano: sono gia' su Blossom, identificati dal loro
 * hash, e l'`imeta` dell'evento vecchio contiene tutto quello che serve.
 */
async function riprendi(id: string): Promise<void> {
  const trovato = await esistente.perId(id)
  if (!trovato) return

  const definizione = getKindDefinition(trovato.kind)
  if (!definizione) {
    esistente.errore.value = `Kind ${trovato.kind} non gestito da questo client.`
    return
  }

  try {
    const dati = definizione.parse(trovato)
    daPrecedente.value = true

    descrizione.value = dati.content ?? ''
    titolo.value = dati.title ?? ''
    hashtag.value = (dati.hashtags ?? []).join(' ')
    if (dati.contentWarning) {
      conAvviso.value = true
      avvisoContenuto.value = dati.contentWarning
    }

    formato.value =
      trovato.kind === 20
        ? 'immagini'
        : trovato.kind === 21
          ? 'video'
          : trovato.kind === 22
            ? 'video-corto'
            : 'file'

    // Gli allegati stanno in `imeta` per i kind 20/21/22 e nei tag piatti per
    // il 1063: si normalizzano qui nella stessa forma che usa l'uploader.
    const allegati =
      trovato.kind === 1063
        ? [
            {
              url: dati.url,
              mime: dati.mime,
              sha256: dati.sha256,
              size: dati.size,
              dim: dati.dim,
              alt: dati.alt,
            },
          ]
        : (dati.images ?? dati.variants ?? [])

    upload.adotta(
      allegati.map((a: Record<string, unknown>) => ({
        nome:
          String(a.url ?? '')
            .split('/')
            .pop() || 'file',
        imeta: a,
        copie: [String(a.url ?? '')],
        anteprima: String(a.url ?? ''),
        descrittore: {
          url: String(a.url ?? ''),
          sha256: String(a.sha256 ?? ''),
          size: Number(a.size ?? 0),
          type: String(a.mime ?? ''),
          uploaded: trovato.created_at,
        },
      })),
    )
  } catch (e) {
    esistente.errore.value = `L’evento non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

onMounted(() => {
  const da = rotta.query.da
  if (typeof da === 'string' && da) void riprendi(da)
})

function ricomincia(): void {
  daPrecedente.value = false
  esistente.errore.value = null
  upload.azzera()
  bozza.azzera()
  titolo.value = ''
  descrizione.value = ''
  hashtag.value = ''
  avvisoContenuto.value = ''
  conAvviso.value = false
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Carica media</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">
        Il file va su un server Blossom, poi l’evento Nostr ne dichiara l’indirizzo e l’impronta.
      </p>
    </div>

    <ClientOnly>
      <div
        v-if="esistente.caricamento.value"
        class="superficie h-16 animate-pulse rounded-xl border"
      />
      <BaseAlert v-if="esistente.errore.value" tono="pericolo">
        {{ esistente.errore.value }}
      </BaseAlert>

      <BaseAlert v-if="daPrecedente" tono="avviso">
        Stai ricomponendo un evento a partire da uno già pubblicato.
        <strong>Non è una modifica</strong>
        : i kind media sono eventi regolari, immutabili come una nota, quindi ne uscirà uno nuovo
        con id diverso e senza le reazioni ricevute dall’originale. I file non vengono ricaricati —
        sono già su Blossom, identificati dal loro hash.
      </BaseAlert>

      <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
        {{ identita.motivoNonFirmabile }}
        <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
        . Blossom autorizza il caricamento con un evento firmato, quindi senza firma non si carica
        nulla.
      </BaseAlert>

      <BaseAlert v-if="!upload.server.value.length" tono="pericolo">
        Nessun server Blossom configurato.
        <NuxtLink to="/impostazioni" class="underline">Impostane uno</NuxtLink>
        .
      </BaseAlert>
    </ClientOnly>

    <BaseCard title="File">
      <div class="flex flex-col gap-4">
        <div
          class="rounded-xl border-2 border-dashed p-6 text-center transition-colors"
          :class="trascinamento ? 'border-[var(--accento)] bg-[var(--sfondo-alt)]' : ''"
          @dragover.prevent="trascinamento = true"
          @dragleave.prevent="trascinamento = false"
          @drop.prevent="rilascia"
        >
          <p class="text-sm text-[var(--testo-tenue)]">
            Trascina qui i file, oppure
            <button
              type="button"
              class="underline"
              :disabled="upload.inCorso.value"
              @click="inputFile?.click()"
            >
              scegline dal disco
            </button>
            .
          </p>
          <input
            ref="inputFile"
            type="file"
            multiple
            class="sr-only"
            accept="image/*,video/*,audio/*,application/pdf"
            @change="scegliFile"
          />
        </div>

        <ClientOnly>
          <div
            v-if="upload.inCorso.value"
            class="flex items-center gap-3 text-sm text-[var(--testo-tenue)]"
          >
            <span class="h-2 w-2 animate-pulse rounded-full bg-[var(--accento)]" />
            <span v-if="upload.stato.value.fase === 'analisi'">
              Misuro {{ upload.stato.value.nome }}…
            </span>
            <span v-else-if="upload.stato.value.fase === 'invio'">
              Carico {{ upload.stato.value.nome }} su {{ upload.stato.value.server }}…
            </span>
            <span v-else-if="upload.stato.value.fase === 'replica'">
              Replico su {{ upload.stato.value.server }}…
            </span>
          </div>

          <BaseAlert v-if="upload.errore.value" tono="pericolo">
            {{ upload.errore.value }}
          </BaseAlert>

          <ul v-if="upload.caricati.value.length" class="flex flex-col gap-3">
            <li
              v-for="(m, i) in upload.caricati.value"
              :key="m.descrittore.sha256"
              class="superficie flex flex-col gap-3 rounded-lg border p-3 sm:flex-row"
            >
              <img
                v-if="(m.imeta.mime ?? '').startsWith('image/')"
                :src="m.anteprima"
                :alt="m.imeta.alt ?? ''"
                class="h-24 w-24 shrink-0 rounded-md object-cover"
              />
              <video
                v-else-if="(m.imeta.mime ?? '').startsWith('video/')"
                :src="m.anteprima"
                class="h-24 w-24 shrink-0 rounded-md object-cover"
                muted
              />
              <div
                v-else
                class="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-[var(--sfondo-alt)] text-xs"
              >
                file
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <p class="truncate text-sm font-medium">{{ m.nome }}</p>
                <dl class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--testo-tenue)]">
                  <div class="flex gap-1">
                    <dt>impronta</dt>
                    <dd>
                      <code>{{ m.descrittore.sha256.slice(0, 12) }}…</code>
                    </dd>
                  </div>
                  <div v-if="m.imeta.dim" class="flex gap-1">
                    <dt>dimensioni</dt>
                    <dd>{{ m.imeta.dim }}</dd>
                  </div>
                  <div class="flex gap-1">
                    <dt>copie</dt>
                    <dd>{{ m.copie.length }}</dd>
                  </div>
                </dl>
                <input
                  class="w-full rounded-md border bg-transparent px-2 py-1 text-xs"
                  placeholder="Descrizione per chi non vede l’immagine (alt)"
                  :value="m.imeta.alt ?? ''"
                  @input="upload.descrivi(i, ($event.target as HTMLInputElement).value)"
                />
              </div>

              <BaseButton size="sm" variant="fantasma" @click="upload.rimuovi(i)">Togli</BaseButton>
            </li>
          </ul>
        </ClientOnly>
      </div>
    </BaseCard>

    <BaseCard v-if="!nessunFile" title="Evento">
      <form class="flex flex-col gap-4" @submit.prevent="componi">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">Pubblica come</legend>
          <label
            v-for="f in formati"
            :key="f.id"
            class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
            :class="formato === f.id ? 'border-[var(--accento)]' : ''"
          >
            <input v-model="formato" type="radio" :value="f.id" class="mt-1" />
            <span class="flex flex-col">
              <span class="text-sm font-medium">{{ f.etichetta }}</span>
              <span class="text-xs text-[var(--testo-tenue)]">{{ f.nota }}</span>
            </span>
          </label>
        </fieldset>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Titolo"
          :required="formato === 'video' || formato === 'video-corto'"
          :hint="
            formato === 'video' || formato === 'video-corto'
              ? 'Obbligatorio per i video: lo richiede NIP-71.'
              : undefined
          "
        >
          <BaseInput :id="id" v-model="titolo" :described-by="describedBy" />
        </BaseField>

        <BaseField v-slot="{ id, describedBy }" label="Descrizione">
          <BaseTextarea :id="id" v-model="descrizione" :rows="3" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Hashtag"
          hint="Separati da spazio o virgola."
        >
          <BaseInput :id="id" v-model="hashtag" :described-by="describedBy" />
        </BaseField>

        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-2 text-sm">
            <input v-model="conAvviso" type="checkbox" />
            Contenuto sensibile
          </label>
          <BaseInput v-if="conAvviso" v-model="avvisoContenuto" placeholder="Motivo dell’avviso" />
        </div>

        <BaseAlert v-if="formato === 'file' && upload.caricati.value.length > 1" tono="info">
          Il kind 1063 descrive un file per evento: viene composto quello del primo file. Gli altri
          {{ upload.caricati.value.length - 1 }} restano caricati e li puoi pubblicare uno alla
          volta.
        </BaseAlert>

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario">Componi evento</BaseButton>
          <ClientOnly>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firmaEPubblica()"
            >
              {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
            </BaseButton>
          </ClientOnly>
          <BaseButton v-if="bozza.template.value" variant="fantasma" @click="ricomincia">
            Ricomincia
          </BaseButton>
        </div>

        <PublishProgress :invio="bozza.invio" />

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
      <PublishResult :esito="bozza.invio.esito.value" />
    </BaseCard>

    <BaseCard v-if="bozza.template.value" title="Evento">
      <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
    </BaseCard>

    <BaseAlert tono="info">
      L’evento porta l’impronta SHA-256 di ogni file: chi lo legge può verificare che quello che
      scarica sia esattamente quello che hai pubblicato. È anche il motivo per cui replicare su più
      server è gratuito — lo stesso file ha lo stesso identificativo ovunque.
    </BaseAlert>
  </div>
</template>
