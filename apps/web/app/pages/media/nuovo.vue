<script setup lang="ts">
import { getKindDefinition } from '@nmc/nostr-core'

useHead({ title: 'Carica media · NostrMediaClient' })

const identita = useIdentity()
const upload = useUpload()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const rotta = useRoute()

/** Vero quando si sta ricomponendo un evento a partire da uno già pubblicato. */
const daPrecedente = ref(false)

/*
 * Il flusso ha tre momenti, e la pagina li tiene separati perché sono
 * decisioni diverse: scegliere un file non è caricarlo, e caricarlo non è
 * pubblicarlo. Da Blossom non si torna indietro davvero — il blob è
 * identificato dal suo hash e chi lo conosce può riscaricarlo — quindi il
 * caricamento chiede una conferma, invece di partire alla scelta del file.
 */

// ─── Opzioni, tutte facoltative ───────────────────────────────────────────
const avanzate = ref(false)
const titolo = ref('')
const descrizione = ref('')
const hashtag = ref('')
const avvisoContenuto = ref('')
const conAvviso = ref(false)

/**
 * Kind con cui pubblicare.
 *
 * Non è una preferenza estetica: cambia chi vedrà il post. Un client
 * picture-first filtra per kind 20 e non mostrerà mai un 1063, e viceversa un
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
  { id: 'video', kind: 21, etichetta: 'Video', nota: 'Kind 21. Orizzontale, di durata piena.' },
  {
    id: 'video-corto',
    kind: 22,
    etichetta: 'Video corto',
    nota: 'Kind 22. Short verticali. La distinzione è di formato, non tecnica.',
  },
  {
    id: 'file',
    kind: 1063,
    etichetta: 'Scheda file',
    nota: 'Kind 1063. Una scheda per file, interrogabile per hash.',
  },
]

const kindScelto = computed(() => formati.find((f) => f.id === formato.value)?.kind ?? 20)

const listaHashtag = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

/** Il formato si adegua a quello che è stato scelto, restando modificabile. */
watch(
  () => upload.media.value.length,
  () => {
    const primo = upload.media.value[0]
    if (!primo) return
    if (primo.mime.startsWith('image/')) formato.value = 'immagini'
    else if (primo.mime.startsWith('video/')) formato.value = 'video'
    else formato.value = 'file'
  },
)

// ─── Scelta dei file ──────────────────────────────────────────────────────
const inputFile = ref<HTMLInputElement | null>(null)
const trascinamento = ref(false)

async function scegliFile(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  if (!target.files?.length) return
  await upload.seleziona(target.files)
  // Azzerare il campo permette di riscegliere lo stesso file, che altrimenti
  // non genererebbe alcun evento `change`.
  target.value = ''
}

async function rilascia(evento: DragEvent): Promise<void> {
  trascinamento.value = false
  const files = evento.dataTransfer?.files
  if (files?.length) await upload.seleziona(files)
}

function pesoLeggibile(byte: number): string {
  if (byte < 1024) return `${byte} B`
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(1)} kB`
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Evento ───────────────────────────────────────────────────────────────
function componi(): void {
  const definizione = getKindDefinition(kindScelto.value)
  if (!definizione) {
    bozza.errore.value = `Kind ${kindScelto.value} non registrato.`
    return
  }

  const allegati = upload.imeta.value
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
      images: allegati,
      ...comune,
    })
    return
  }

  if (kindScelto.value === 21 || kindScelto.value === 22) {
    bozza.costruisci(definizione, {
      content: descrizione.value.trim(),
      title: titolo.value.trim(),
      variants: allegati,
      ...comune,
    })
    return
  }

  // 1063: una scheda per file. Si compone la prima e si dice quante restano,
  // invece di fingere che un solo evento le contenga tutte.
  const primo = allegati[0]
  if (!primo) return
  bozza.costruisci(definizione, { content: descrizione.value.trim(), ...primo })
}

function ricomincia(): void {
  upload.azzera()
  bozza.azzera()
  daPrecedente.value = false
  esistente.errore.value = null
  titolo.value = ''
  descrizione.value = ''
  hashtag.value = ''
  avvisoContenuto.value = ''
  conAvviso.value = false
  avanzate.value = false
}

// ─── Ripresa di un evento già pubblicato ──────────────────────────────────
/**
 * Ricompone un evento media partendo da uno già pubblicato.
 *
 * Non è una modifica e il form lo dice: i kind media sono **regolari**, quindi
 * immutabili come una nota. I file però non si ricaricano — sono già su
 * Blossom, identificati dal loro hash.
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
    avanzate.value = true

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
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Carica media</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">
        Il file va su un server Blossom. Solo dopo, e solo se vuoi, un evento Nostr ne dichiara
        l’indirizzo.
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
        sono già su Blossom.
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

    <!-- ─────────── 1. Scelta, tutta in locale ─────────── -->
    <BaseCard title="1 · Scegli i file" subtitle="Restano nel browser: qui non parte nulla.">
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
          <p v-if="upload.fase.value.fase === 'analisi'" class="text-sm text-[var(--testo-tenue)]">
            Misuro {{ upload.fase.value.nome }}…
          </p>

          <ul v-if="!upload.nessunoSelezionato.value" class="flex flex-col gap-3">
            <li
              v-for="m in upload.media.value"
              :key="m.id"
              class="superficie flex flex-col gap-3 rounded-lg border p-3 sm:flex-row"
            >
              <img
                v-if="m.mime.startsWith('image/')"
                :src="m.anteprima"
                :alt="m.alt"
                class="h-28 w-28 shrink-0 rounded-md border object-cover"
              />
              <video
                v-else-if="m.mime.startsWith('video/')"
                :src="m.anteprima"
                class="h-28 w-28 shrink-0 rounded-md border object-cover"
                controls
                muted
              />
              <div
                v-else
                class="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-[var(--sfondo-alt)] text-xs"
              >
                {{ m.mime.split('/')[1] ?? 'file' }}
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-sm font-medium">{{ m.nome }}</p>
                  <BaseBadge v-if="m.stato === 'in-attesa'">da caricare</BaseBadge>
                  <BaseBadge v-else-if="m.stato === 'in-corso'" tono="avviso">in corso</BaseBadge>
                  <BaseBadge v-else-if="m.stato === 'caricato'" tono="successo">
                    su Blossom
                  </BaseBadge>
                  <BaseBadge v-else tono="avviso">non caricato</BaseBadge>
                </div>

                <dl class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--testo-tenue)]">
                  <div class="flex gap-1">
                    <dt>tipo</dt>
                    <dd>{{ m.mime }}</dd>
                  </div>
                  <div class="flex gap-1">
                    <dt>peso</dt>
                    <dd>{{ pesoLeggibile(m.dimensioneByte) }}</dd>
                  </div>
                  <div v-if="m.dim" class="flex gap-1">
                    <dt>dimensioni</dt>
                    <dd>{{ m.dim }}</dd>
                  </div>
                  <div v-if="m.descrittore" class="flex gap-1">
                    <dt>impronta</dt>
                    <dd>
                      <code>{{ m.descrittore.sha256.slice(0, 12) }}…</code>
                    </dd>
                  </div>
                  <div v-if="m.copie.length" class="flex gap-1">
                    <dt>copie</dt>
                    <dd>{{ m.copie.length }}</dd>
                  </div>
                </dl>

                <p v-if="m.errore" class="text-xs text-[var(--pericolo)]">{{ m.errore }}</p>
                <p v-else-if="m.alt" class="truncate text-xs text-[var(--testo-tenue)]">
                  «{{ m.alt }}»
                </p>
              </div>

              <BaseButton
                size="sm"
                variant="fantasma"
                :disabled="upload.inCorso.value"
                @click="upload.rimuovi(m.id)"
              >
                Togli
              </BaseButton>
            </li>
          </ul>
        </ClientOnly>
      </div>
    </BaseCard>

    <!-- ─────────── 2. Opzioni, solo se servono ─────────── -->
    <ClientOnly>
      <BaseCard v-if="!upload.nessunoSelezionato.value">
        <details :open="avanzate" @toggle="avanzate = ($event.target as HTMLDetailsElement).open">
          <summary class="cursor-pointer text-sm font-medium">
            2 · Descrizione e formato
            <span class="font-normal text-[var(--testo-tenue)]">
              — facoltativo, tutto in una volta
            </span>
          </summary>

          <div class="mt-4 flex flex-col gap-4">
            <p class="text-sm text-[var(--testo-tenue)]">
              Senza toccare nulla si pubblica una galleria senza titolo né descrizione. Quello che
              conta davvero è la descrizione per chi non vede il file.
            </p>

            <div v-for="m in upload.media.value" :key="`alt-${m.id}`" class="flex flex-col gap-1">
              <label :for="`alt-campo-${m.id}`" class="truncate text-xs font-medium">
                Descrizione di «{{ m.nome }}»
              </label>
              <input
                :id="`alt-campo-${m.id}`"
                class="superficie w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Cosa si vede, per chi non può vederlo"
                :value="m.alt"
                @input="upload.descrivi(m.id, ($event.target as HTMLInputElement).value)"
              />
            </div>

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
              <BaseInput
                v-if="conAvviso"
                v-model="avvisoContenuto"
                placeholder="Motivo dell’avviso"
              />
            </div>
          </div>
        </details>
      </BaseCard>
    </ClientOnly>

    <!-- ─────────── 3. Caricamento su Blossom ─────────── -->
    <ClientOnly>
      <BaseCard
        v-if="!upload.nessunoSelezionato.value"
        title="3 · Carica su Blossom"
        subtitle="Da qui in poi il file esce dal browser."
      >
        <div class="flex flex-col gap-3">
          <p v-if="upload.inCorso.value" class="flex items-center gap-2 text-sm">
            <span class="h-2 w-2 animate-pulse rounded-full bg-[var(--accento)]" />
            <span v-if="upload.fase.value.fase === 'invio'">
              Carico {{ upload.fase.value.nome }} su {{ upload.fase.value.server }}…
            </span>
            <span v-else-if="upload.fase.value.fase === 'replica'">
              Replico su {{ upload.fase.value.server }}…
            </span>
          </p>

          <BaseAlert v-if="upload.errore.value" tono="pericolo">
            {{ upload.errore.value }}
          </BaseAlert>

          <BaseAlert v-if="upload.tuttoCaricato.value" tono="successo">
            {{ upload.caricati.value.length }}
            {{ upload.caricati.value.length === 1 ? 'file è' : 'file sono' }}
            su Blossom.
            <strong>Puoi fermarti qui</strong>
            : il file è raggiungibile dal suo indirizzo anche senza pubblicare alcun evento.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton
              v-if="upload.daCaricare.value.length"
              variant="primario"
              :loading="upload.inCorso.value"
              :disabled="!identita.puoFirmare || !upload.server.value.length"
              @click="upload.caricaSelezionati()"
            >
              Carica {{ upload.daCaricare.value.length }}
              {{ upload.daCaricare.value.length === 1 ? 'file' : 'file' }} su
              {{ upload.server.value[0] }}
            </BaseButton>
            <BaseButton variant="fantasma" :disabled="upload.inCorso.value" @click="ricomincia">
              Ricomincia
            </BaseButton>
          </div>

          <ul v-if="upload.caricati.value.length" class="flex flex-col gap-1 text-xs">
            <li v-for="m in upload.caricati.value" :key="`url-${m.id}`" class="truncate">
              <a
                :href="m.descrittore?.url"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >
                {{ m.descrittore?.url }}
              </a>
            </li>
          </ul>
        </div>
      </BaseCard>
    </ClientOnly>

    <!-- ─────────── 4. Evento Nostr, facoltativo ─────────── -->
    <ClientOnly>
      <BaseCard
        v-if="upload.caricati.value.length"
        title="4 · Pubblica un evento"
        subtitle="Un evento Nostr che punta ai file. Facoltativo e separato dal caricamento."
      >
        <form class="flex flex-col gap-4" @submit.prevent="componi">
          <BaseAlert v-if="formato === 'file' && upload.caricati.value.length > 1" tono="info">
            Il kind 1063 descrive un file per evento: viene composto quello del primo. Gli altri
            {{ upload.caricati.value.length - 1 }} restano su Blossom e li puoi pubblicare uno alla
            volta.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton type="submit" variant="primario">Componi evento</BaseButton>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firmaEPubblica()"
            >
              {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
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
    </ClientOnly>

    <BaseAlert tono="info">
      L’evento porta l’impronta SHA-256 di ogni file: chi lo legge può verificare che quello che
      scarica sia esattamente quello che hai pubblicato. È anche il motivo per cui replicare su più
      server è gratuito — lo stesso file ha lo stesso identificativo ovunque.
    </BaseAlert>
  </div>
</template>
