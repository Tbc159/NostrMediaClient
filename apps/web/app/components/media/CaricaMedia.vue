<script setup lang="ts">
import {
  completezzaEpisodio,
  getKindDefinition,
  normalizeHashtag,
  leggiBozzaEpisodio,
  mirrorBlob,
  parsePublicKeyInput,
  audioAdattoAlPodcast,
  type BozzaEpisodio,
  type DatiBozzaEpisodio,
  type Firmatario,
} from '@nmc/nostr-core'
import { useConsegna } from '~/stores/consegna'
import { useDeleghe } from '~/stores/deleghe'

/**
 * The uploader, in two guises.
 *
 * «generico» is the Upload to Blossom tab: images, videos, notes, file cards.
 * «podcast» is the Podcast tab: the same flow — file, Blossom, event — but the
 * mode is fixed, and around it are the things an episode alone needs: drafts,
 * the proposal, the show's card. A single component because the three steps
 * really are the same; two pages because whoever publishes an episode should
 * not have to pick «podcast» out of six formats.
 */
const props = defineProps<{ modalita: 'generico' | 'podcast' }>()
const perPodcast = computed(() => props.modalita === 'podcast')

const identita = useIdentity()
const deleghe = useDeleghe()
const upload = useUpload()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const schedaPodcast = useEventoEsistente()
const bozzeEpisodio = useBozzeEpisodio()
const consegna = useConsegna()
const rotta = useRoute()

/** True when an event is being recomposed starting from an already published one. */
const daPrecedente = ref(false)

/*
 * The flow has three moments, and the page keeps them separate because they
 * are different decisions: choosing a file is not uploading it, and uploading
 * it is not publishing it. There is no real coming back from Blossom — the
 * blob is identified by its hash and whoever knows it can download it again —
 * so the upload asks for a confirmation, instead of starting when the file is
 * chosen.
 */

// ─── The options, all optional ────────────────────────────────────────────
const avanzate = ref(false)
const titolo = ref('')
const descrizione = ref('')
/** For the episodes alone: the long notes, in Markdown, that go in the content. */
const noteEpisodio = ref('')
/** For the episodes alone: the image's URL, written or obtained by uploading it. */
const immagineEpisodio = ref('')
const hashtag = ref('')
const avvisoContenuto = ref('')
const conAvviso = ref(false)

/**
 * The kind to publish with.
 *
 * It is not an aesthetic preference: it changes who will see the post. A
 * picture-first client filters for kind 20 and will never show a 1063, and
 * conversely a file client does not lay out galleries.
 */
type Formato = 'nota' | 'immagini' | 'video' | 'video-corto' | 'podcast' | 'file'
const formato = ref<Formato>(props.modalita === 'podcast' ? 'podcast' : 'nota')

/**
 * Which kind to publish with.
 *
 * It is not an aesthetic preference: **it changes who will see the post**. The
 * dedicated media kinds are more precise, but only whoever filters for them
 * shows them; a note with an attachment is rendered by any social client. That
 * is why the list starts there.
 */
const formati = computed<{ id: Formato; kind: number; etichetta: string; nota: string }[]>(() => {
  const quanti = upload.media.value.length
  const uno = quanti <= 1

  const tutti: { id: Formato; kind: number; etichetta: string; nota: string }[] = [
    {
      id: 'nota',
      kind: 1,
      etichetta: uno ? 'Nota con allegato' : `Nota con ${quanti} allegati`,
      nota: 'Kind 1. La mostra qualunque client sociale: è il modo più sicuro perché il file venga visto. L’indirizzo finisce anche nel testo, come vuole NIP-92.',
    },
    {
      id: 'immagini',
      kind: 20,
      etichetta: uno ? 'Immagine' : `Galleria di ${quanti} immagini`,
      nota: 'Kind 20. L’immagine è il contenuto, non un allegato al testo. La leggono i client dedicati alle immagini.',
    },
    { id: 'video', kind: 21, etichetta: 'Video', nota: 'Kind 21. Orizzontale, di durata piena.' },
    {
      id: 'video-corto',
      kind: 22,
      etichetta: 'Video corto',
      nota: 'Kind 22. Short verticali. La distinzione è di formato, non tecnica.',
    },
    {
      id: 'podcast',
      kind: 54,
      etichetta: 'Episodio di podcast',
      nota: 'Kind 54 (NIP-F4). L’unico kind audio standardizzato. Attenzione: per NIP-F4 il podcast è la chiave stessa, quindi la tua identità diventa il podcast.',
    },
    {
      id: 'file',
      kind: 1063,
      etichetta: 'Solo scheda del file',
      nota: 'Kind 1063. Una voce di catalogo interrogabile per hash, non un post: NIP-94 dice che i client sociali non sono tenuti a mostrarla. Utile per indicizzare un file, non per farlo vedere.',
    },
  ]
  // The episode has its own tab: here it is not one option among others.
  return perPodcast.value
    ? tutti.filter((f) => f.id === 'podcast')
    : tutti.filter((f) => f.id !== 'podcast')
})

const kindScelto = computed(() => formati.value.find((f) => f.id === formato.value)?.kind ?? 1)

/*
 * Who will sign the event: your own key, or a NIP-46 delegation.
 *
 * It is not a preference: with a delegation the event comes out with somebody
 * else's `pubkey`, and for Nostr that is the author. It serves the case NIP-F4
 * leaves everyone else exposed to — the podcast *is* a key, so whoever
 * prepares the episodes without holding it has no other way of publishing
 * them in its name.
 */
const firmaCon = ref('')

onMounted(() => deleghe.carica())

const delegaScelta = computed(() =>
  firmaCon.value ? deleghe.elenco.find((d) => d.pubkey === firmaCon.value) : undefined,
)

const scelteFirma = computed(() => [
  { value: '', label: 'La mia chiave' },
  ...deleghe.elenco.map((d) => ({ value: d.pubkey, label: d.etichetta })),
])

const firmatario = computed<Firmatario | undefined>(() => {
  const pubkey = firmaCon.value
  if (!pubkey) return undefined
  return {
    pubkey: () => Promise.resolve(pubkey),
    firma: (template) => deleghe.firma(pubkey, template),
  }
})

// When the signer changes the signature already obtained is no longer valid:
// it is another identity's. Keeping it would publish in a name not chosen.
watch(firmaCon, () => {
  bozza.firmato.value = null
})

// The lower case applies to what is written here: the kinds write the `t`
// tags as they receive them, so as not to rewrite the ones read from other clients.
const listaHashtag = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((s) => normalizeHashtag(s))
    .filter(Boolean),
)

/*
 * The format adapts to the type of file, while staying editable.
 *
 * For audio and for everything else the default value is the note with an
 * attachment, not the dedicated kind: it is the only one seen everywhere, and
 * a default that publishes something nobody shows would be a trap.
 */
/**
 * True when the format was decided by whoever sent us here — the Audio page, a
 * draft, a proposal — and the file's type must not reopen the question.
 */
const formatoForzato = ref(props.modalita === 'podcast')

watch(
  () => upload.media.value.length,
  () => {
    if (formatoForzato.value) return
    const primo = upload.media.value[0]
    if (!primo) return
    if (primo.mime.startsWith('image/')) formato.value = 'immagini'
    else if (primo.mime.startsWith('video/')) formato.value = 'video'
    else formato.value = 'nota'
  },
)

// ─── Scelta dei file ──────────────────────────────────────────────────────
const inputFile = ref<HTMLInputElement | null>(null)
const trascinamento = ref(false)

async function scegliFile(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  if (!target.files?.length) return
  await upload.seleziona(target.files)
  // Clearing the field allows the same file to be chosen again, which
  // otherwise would generate no `change` event at all.
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

  if (kindScelto.value === 1) {
    bozza.costruisci(definizione, {
      content: descrizione.value.trim(),
      attachments: allegati,
      ...(listaHashtag.value.length ? { hashtags: listaHashtag.value } : {}),
    })
    return
  }

  if (kindScelto.value === 54) {
    // The audio alone ends up in the `audio` tag: an image uploaded alongside
    // is the cover, and goes in the `image` tag, not among the sources.
    const audio = allegati.filter((a) => (a.mime ?? '').startsWith('audio/'))
    // The duration is measured by the browser when the file is chosen; NIP-F4
    // does not provide for it, but the apps show it (itunes:duration) and
    // without it the episode's row is left without minutes.
    const durata = audio.find((a) => a.duration !== undefined)?.duration
    bozza.costruisci(definizione, {
      title: titolo.value.trim(),
      content: noteEpisodio.value.trim(),
      description: descrizione.value.trim(),
      ...(immagineEpisodio.value.trim() ? { image: immagineEpisodio.value.trim() } : {}),
      audio: audio.map((a) => ({ url: a.url, ...(a.mime ? { mime: a.mime } : {}) })),
      ...(durata ? { duration: durata } : {}),
    })
    return
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

  // 1063: one card per file. The first is composed and how many are left is
  // said, instead of pretending a single event holds them all.
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
  noteEpisodio.value = ''
  immagineEpisodio.value = ''
  hashtag.value = ''
  avvisoContenuto.value = ''
  conAvviso.value = false
  avanzate.value = false
  formatoForzato.value = false
  idBozza.value = null
  bozzaSalvata.value = null
  propostaImportata.value = null
  perChiaveProposta.value = ''
  erroreEpisodio.value = null
}

// ─── Picking an already published event up again ───────────────────────────
/**
 * Recomposes a media event starting from an already published one.
 *
 * It is not an edit and the form says so: the media kinds are **regular**,
 * hence as immutable as a note. The files, though, are not re-uploaded — they
 * are on Blossom already, identified by their hash.
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

    descrizione.value = trovato.kind === 54 ? (dati.description ?? '') : (dati.content ?? '')
    noteEpisodio.value = trovato.kind === 54 ? (dati.content ?? '') : ''
    immagineEpisodio.value = trovato.kind === 54 ? (dati.image ?? '') : ''
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
            : trovato.kind === 54
              ? 'podcast'
              : 'file'
    formatoForzato.value = true

    // An episode declares its audio with `audio`, not with `imeta`: no hash
    // and no size. What is there is adopted, and that is said.
    const allegati =
      trovato.kind === 54
        ? (dati.audio ?? []).map((a: { url: string; mime?: string }) => ({
            url: a.url,
            ...(a.mime ? { mime: a.mime } : {}),
          }))
        : trovato.kind === 1063
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

// ─── Episodes: drafts, proposals, the image ────────────────────────────────
/*
 * An episode draft is the form's data plus the files already on Blossom. A
 * file chosen but not yet uploaded does not fit: it has no address. That is
 * said when saving, instead of suggesting it is there.
 */
const idBozza = ref<string | null>(null)
const bozzaSalvata = ref<BozzaEpisodio | null>(null)
const propostaImportata = ref<BozzaEpisodio | null>(null)
/** The optional npub of whoever should publish the exported proposal. */
const perChiaveProposta = ref('')
const erroreEpisodio = ref<string | null>(null)
const copiaInCorso = ref(false)
/** `null` until we have looked; then whether this key has a 10154 card. */
const haSchedaPodcast = ref<boolean | null>(null)

const allegatiPerBozza = computed(() =>
  upload.caricati.value.flatMap((m) =>
    m.descrittore
      ? [
          {
            nome: m.nome,
            imeta: upload.imeta.value.find((i) => i.url === m.descrittore?.url) ?? {
              url: m.descrittore.url,
            },
            descrittore: m.descrittore,
            copie: m.copie,
          },
        ]
      : [],
  ),
)

const datiEpisodio = computed(() => ({
  titolo: titolo.value.trim(),
  descrizione: descrizione.value.trim(),
  contenuto: noteEpisodio.value.trim(),
  hashtag: listaHashtag.value,
  ...(immagineEpisodio.value.trim() ? { immagine: immagineEpisodio.value.trim() } : {}),
}))

/** What is missing for the episode to be publishable. For the podcast alone. */
const completezza = computed(() =>
  completezzaEpisodio({ episodio: datiEpisodio.value, allegati: allegatiPerBozza.value }),
)

/** How many chosen files are not on Blossom yet, and hence do not go into a draft. */
const nonAncoraCaricati = computed(() => upload.daCaricare.value.length)

function datiBozza(): DatiBozzaEpisodio {
  return {
    ...(idBozza.value ? { id: idBozza.value } : {}),
    ...(bozzaSalvata.value ? { creataAlle: bozzaSalvata.value.creataAlle } : {}),
    ...(identita.npub ? { preparataDa: identita.npub } : {}),
    ...(perChiaveProposta.value.trim() ? { perChiave: perChiaveProposta.value.trim() } : {}),
    episodio: datiEpisodio.value,
    allegati: allegatiPerBozza.value,
  }
}

function salvaBozza(): void {
  erroreEpisodio.value = null
  try {
    const salvata = bozzeEpisodio.salva(datiBozza())
    idBozza.value = salvata.id
    bozzaSalvata.value = salvata
  } catch (e) {
    erroreEpisodio.value = e instanceof Error ? e.message : String(e)
  }
}

/** Fills the form from a draft: the files come back as «already on Blossom». */
function applicaBozza(b: BozzaEpisodio): void {
  formato.value = 'podcast'
  formatoForzato.value = true
  avanzate.value = true
  titolo.value = b.episodio.titolo
  descrizione.value = b.episodio.descrizione
  noteEpisodio.value = b.episodio.contenuto
  immagineEpisodio.value = b.episodio.immagine ?? ''
  hashtag.value = b.episodio.hashtag.join(' ')
  upload.adotta(b.allegati)
}

function caricaBozza(id: string): void {
  const trovata = bozzeEpisodio.trova(id)
  if (!trovata) {
    erroreEpisodio.value = 'Bozza non trovata in questo browser.'
    return
  }
  idBozza.value = trovata.id
  bozzaSalvata.value = trovata
  applicaBozza(trovata)
}

/**
 * Downloads the draft as a proposal: whoever imports it sees this data, the
 * files already on Blossom, and signs with their own key.
 */
function esportaProposta(): void {
  erroreEpisodio.value = null
  let contenuto: string
  try {
    if (perChiaveProposta.value.trim()) parsePublicKeyInput(perChiaveProposta.value.trim())
    const proposta = bozzeEpisodio.salva(datiBozza())
    idBozza.value = proposta.id
    bozzaSalvata.value = proposta
    contenuto = JSON.stringify(proposta, null, 2)
  } catch (e) {
    erroreEpisodio.value = e instanceof Error ? e.message : String(e)
    return
  }
  const url = URL.createObjectURL(new Blob([contenuto], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `proposta-episodio-${(titolo.value.trim() || 'senza-titolo').replace(/[^\w-]+/g, '-').toLowerCase()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function importaProposta(evento: Event): Promise<void> {
  const target = evento.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  erroreEpisodio.value = null
  try {
    const letta = leggiBozzaEpisodio(await file.text())
    propostaImportata.value = letta
    // An imported proposal is a new draft of *this* identity: it does not
    // inherit the id, so saving it overwrites nothing of the writer's.
    idBozza.value = null
    bozzaSalvata.value = null
    applicaBozza(letta)
  } catch (e) {
    erroreEpisodio.value = e instanceof Error ? e.message : String(e)
  }
}

/** The hexadecimal pubkey of the key the proposal expects, when readable. */
const chiaveAttesa = computed(() => {
  const p = propostaImportata.value?.perChiave
  if (!p) return null
  try {
    return parsePublicKeyInput(p)
  } catch {
    return null
  }
})

const propostaPerAltri = computed(
  () =>
    chiaveAttesa.value !== null &&
    identita.pubkey !== null &&
    chiaveAttesa.value !== identita.pubkey,
)

/**
 * Copies the proposal's files to your own Blossom server.
 *
 * On Blossom a file can be deleted only by whoever uploaded it: whoever
 * publishes an episode with files uploaded by somebody else depends on them.
 * The copy puts the bytes under your own key too — the same hash, the same
 * final URL with another host — and stays optional.
 */
async function copiaSuMioServer(): Promise<void> {
  const server = upload.server.value[0]
  if (!server || !identita.puoFirmare) return
  copiaInCorso.value = true
  erroreEpisodio.value = null
  try {
    const aggiornati = await Promise.all(
      allegatiPerBozza.value.map(async (a) => {
        const copia = await mirrorBlob(server, a.descrittore.url, a.descrittore.sha256, {
          firma: (t) => identita.firma(t),
          pubkey: identita.pubkey ?? '',
        })
        return {
          ...a,
          copie: a.copie.includes(server) ? a.copie : [...a.copie, server],
          imeta: { ...a.imeta, fallback: [...(a.imeta.fallback ?? []), copia.url] },
        }
      }),
    )
    upload.adotta(aggiornati)
  } catch (e) {
    erroreEpisodio.value = `Copia non riuscita: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    copiaInCorso.value = false
  }
}

/**
 * The audio the platforms do not accept in the enclosures.
 *
 * The feed declares them with the right MIME, but Apple, Spotify, Amazon and
 * YouTube read mp3 and m4a: a wav or an ogg would end up in the feed and stay
 * mute in the apps. It is said here, where you can still go back to the Audio
 * tab.
 */
const audioNonAdatti = computed(() =>
  upload.media.value.filter((m) => m.mime.startsWith('audio/') && !audioAdattoAlPodcast(m.mime)),
)

// The 10154 card is looked up only when needed: on the first visit to «podcast».
watch(
  formato,
  async (f) => {
    if (f !== 'podcast' || haSchedaPodcast.value !== null || !identita.pubkey) return
    haSchedaPodcast.value = (await schedaPodcast.perCoordinata(10154)) !== null
  },
  { immediate: true },
)

/*
 * The query is watched, not read once only: «Resume» leads from
 * /media/podcast to /media/podcast?bozza=…, the same route, and the component
 * does not remount. An `onMounted` here would have loaded the draft only when
 * arriving from another page — and indeed that happened.
 */
watch(
  () => [rotta.query.da, rotta.query.bozza] as const,
  ([da, idDaRiprendere]) => {
    if (typeof da === 'string' && da) void riprendi(da)
    else if (typeof idDaRiprendere === 'string' && idDaRiprendere) caricaBozza(idDaRiprendere)
  },
  { immediate: true },
)

onMounted(async () => {
  if (rotta.query.da || rotta.query.bozza) return
  // A file handed over by the Audio page: as though the user had chosen it
  // from disk. Only the Podcast tab collects it: that is where the Audio page sends.
  if (!perPodcast.value) return
  avanzate.value = true
  const consegnato = consegna.ritira()
  if (consegnato) await upload.seleziona([consegnato.file])
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="perPodcast">
      <h1 class="text-xl font-semibold tracking-tight">Pubblica un episodio</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">
        L’audio va su Blossom; poi un evento kind 54 (NIP-F4) lo dichiara come episodio. Se arrivi
        dalla scheda Audio il file è già qui. Puoi fermarti a metà: quello che hai fatto si salva
        come bozza.
      </p>
    </div>
    <div v-else>
      <h1 class="text-xl font-semibold tracking-tight">Carica media</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">
        Il file va su un server Blossom. Solo dopo, e solo se vuoi, un evento Nostr ne dichiara
        l’indirizzo. Per un episodio di podcast c’è la scheda
        <NuxtLink to="/media/podcast" class="underline">Podcast</NuxtLink>
        .
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

      <BaseAlert v-if="propostaImportata" :tono="propostaPerAltri ? 'avviso' : 'info'">
        <strong>Proposta di episodio importata</strong>
        <template v-if="propostaImportata.preparataDa">
          , preparata da
          <code class="break-all">{{ propostaImportata.preparataDa }}</code>
        </template>
        <template v-if="propostaImportata.perChiave">
          per
          <code class="break-all">{{ propostaImportata.perChiave }}</code>
        </template>
        . I file sono già su Blossom, caricati da chi l’ha preparata. Controlla i dati, poi firma e
        pubblica: l’episodio sarà di
        <strong>questa</strong>
        identità.
        <span v-if="propostaPerAltri" class="mt-1 block">
          Attenzione: era pensata per un’altra chiave. Puoi pubblicarla lo stesso, ma l’episodio
          apparterrà a te, non a quella.
        </span>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <BaseButton
            size="sm"
            :loading="copiaInCorso"
            :disabled="!identita.puoFirmare || !upload.server.value.length"
            @click="copiaSuMioServer"
          >
            Copia i file sul tuo server Blossom
          </BaseButton>
          <span class="text-xs">
            Facoltativo: su Blossom un file lo cancella solo chi l’ha caricato. Con la copia, i byte
            stanno anche sotto la tua chiave.
          </span>
        </div>
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

        <p v-if="perPodcast" class="text-xs text-[var(--testo-tenue)]">
          Hai ricevuto una proposta di episodio da un’altra identità?
          <label class="cursor-pointer underline">
            Importala
            <input
              type="file"
              accept="application/json,.json"
              class="sr-only"
              @change="importaProposta"
            />
          </label>
          : i file sono già su Blossom, qui li controlli e li firmi tu.
        </p>

        <BaseAlert v-if="erroreEpisodio" tono="pericolo">{{ erroreEpisodio }}</BaseAlert>

        <BaseAlert v-if="perPodcast && audioNonAdatti.length" tono="avviso">
          <strong>
            {{ audioNonAdatti.map((m) => m.nome).join(', ') }}
            {{ audioNonAdatti.length === 1 ? 'non è' : 'non sono' }} in mp3 o m4a
          </strong>
          ({{ [...new Set(audioNonAdatti.map((m) => m.mime))].join(', ') }}). Il feed li dichiarerà
          col tipo giusto, ma Apple, Spotify, Amazon e YouTube leggono solo mp3 e m4a: nelle loro
          app l’episodio resterebbe muto. Convertilo dalla
          <NuxtLink to="/media/audio" class="underline">scheda Audio</NuxtLink>
          , scegliendo mp3 come formato in uscita.
        </BaseAlert>

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

    <!-- ─────────── 2. The options, only when needed ─────────── -->
    <ClientOnly>
      <BaseCard v-if="!upload.nessunoSelezionato.value">
        <details :open="avanzate" @toggle="avanzate = ($event.target as HTMLDetailsElement).open">
          <summary class="cursor-pointer text-sm font-medium">
            <template v-if="perPodcast">
              2 · L’episodio
              <span class="font-normal text-[var(--testo-tenue)]">
                — titolo e descrizione servono
              </span>
            </template>
            <template v-else>
              2 · Descrizione e formato
              <span class="font-normal text-[var(--testo-tenue)]">
                — facoltativo, tutto in una volta
              </span>
            </template>
          </summary>

          <div class="mt-4 flex flex-col gap-4">
            <p v-if="!perPodcast" class="text-sm text-[var(--testo-tenue)]">
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

            <fieldset v-if="!perPodcast" class="flex flex-col gap-2">
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

            <BaseAlert v-if="formato === 'nota'" tono="info">
              Una nota non ha titolo: quello che scrivi in «descrizione» è il testo della nota, e
              l’indirizzo del file viene aggiunto in coda perché i client lo trasformino in
              anteprima.
            </BaseAlert>

            <BaseAlert v-else-if="formato === 'podcast'" tono="avviso">
              Per NIP-F4
              <strong>il podcast è la chiave stessa</strong>
              : pubblicando un episodio con questa identità, questa identità
              <em>diventa</em>
              il podcast.
              <template v-if="haSchedaPodcast === false">
                <strong>Questa chiave non ha ancora una scheda del podcast</strong>
                (kind 10154): i lettori mostrano gli episodi sotto quella. Si compone dal
                <NuxtLink to="/profilo" class="underline">profilo</NuxtLink>
                — puoi farlo anche dopo aver pubblicato.
              </template>
              <template v-else>
                La scheda dello show (kind 10154) si compone dal
                <NuxtLink to="/profilo" class="underline">profilo</NuxtLink>
                .
              </template>
            </BaseAlert>

            <BaseAlert v-else-if="formato === 'file'" tono="avviso">
              NIP-94 dice che i client sociali non sono tenuti a mostrare il kind 1063: serve a
              indicizzare un file, non a farlo vedere. Se vuoi che qualcuno lo veda, scegli «nota
              con allegato».
            </BaseAlert>

            <BaseField
              v-if="formato !== 'nota'"
              v-slot="{ id, describedBy }"
              label="Titolo"
              :required="['video', 'video-corto', 'podcast'].includes(formato)"
              :hint="
                formato === 'podcast'
                  ? 'Obbligatorio: è come si trova l’episodio in un lettore di podcast.'
                  : formato === 'video' || formato === 'video-corto'
                    ? 'Obbligatorio per i video: lo richiede NIP-71.'
                    : undefined
              "
            >
              <BaseInput :id="id" v-model="titolo" :described-by="describedBy" />
            </BaseField>

            <BaseField
              v-slot="{ id, describedBy }"
              :label="formato === 'nota' ? 'Testo della nota' : 'Descrizione'"
              :required="formato === 'podcast'"
              :hint="
                formato === 'podcast'
                  ? 'Obbligatoria per NIP-F4: i lettori la mostrano sotto il titolo.'
                  : undefined
              "
            >
              <BaseTextarea :id="id" v-model="descrizione" :rows="3" :described-by="describedBy" />
            </BaseField>

            <template v-if="formato === 'podcast'">
              <BaseField
                v-slot="{ id, describedBy }"
                label="Note dell’episodio"
                hint="Facoltative, in Markdown: capitoli, link, ringraziamenti. Vanno nel corpo dell’evento."
              >
                <BaseTextarea
                  :id="id"
                  v-model="noteEpisodio"
                  :rows="4"
                  :described-by="describedBy"
                />
              </BaseField>

              <MediaCopertinaQuadrata
                v-model="immagineEpisodio"
                label="Immagine dell’episodio"
                hint="Facoltativa. Un indirizzo, oppure carica un’immagine: passa dal ritaglio quadrato e va su Blossom."
              />
            </template>

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

            <!--
              The work can be put aside at any moment, even before the upload.
              The files not yet on Blossom do not fit, though: they have no
              address, and that is said.
            -->
            <div v-if="formato === 'podcast'" class="flex flex-wrap items-center gap-2">
              <BaseButton size="sm" @click="salvaBozza">Salva come bozza</BaseButton>
              <span v-if="nonAncoraCaricati" class="text-xs text-[var(--testo-tenue)]">
                {{ nonAncoraCaricati }}
                {{ nonAncoraCaricati === 1 ? 'file non è' : 'file non sono' }}
                ancora su Blossom e non entrano nella bozza: si ricaricano quando la riprendi.
              </span>
              <BaseBadge v-if="bozzaSalvata" tono="successo">
                bozza salvata ·
                <NuxtLink to="/media/podcast" class="underline">le tue bozze</NuxtLink>
              </BaseBadge>
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

          <BaseAlert v-if="formato === 'podcast' && !completezza.pronta" tono="avviso">
            Per pubblicare l’episodio manca ancora: {{ completezza.manca.join(', ') }}. Puoi salvare
            la bozza e tornare dopo.
          </BaseAlert>

          <!--
            The delegation is the *synchronous* way to have another key sign:
            the other person has the desk open and approves now. The exportable
            proposal, further down, is the asynchronous one. They coexist.
          -->
          <BaseField
            v-if="deleghe.elenco.length"
            label="Chi firma"
            hint="Con una delega l’evento esce a nome dell’altra identità: dall’altra parte una persona deve approvarlo."
          >
            <template #default="{ id }">
              <BaseSelect :id="id" v-model="firmaCon" :options="scelteFirma" />
            </template>
          </BaseField>

          <BaseAlert v-if="delegaScelta" tono="avviso">
            L’evento risulterà pubblicato da
            <strong>{{ delegaScelta.etichetta }}</strong>
            e non comparirà fra i tuoi: per Nostr non è tuo. Se il banco è chiuso o la richiesta
            viene rifiutata, la firma non arriva e non si pubblica nulla.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton
              type="submit"
              variant="primario"
              :disabled="formato === 'podcast' && !completezza.pronta"
            >
              Componi evento
            </BaseButton>
            <BaseButton
              v-if="bozza.template.value && !bozza.pubblicato.value"
              variant="primario"
              :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firmaEPubblica(firmatario)"
            >
              <template v-if="bozza.firmato.value">Pubblica</template>
              <template v-else-if="delegaScelta">Chiedi la firma e pubblica</template>
              <template v-else>Firma e pubblica</template>
            </BaseButton>
            <template v-if="formato === 'podcast'">
              <BaseButton @click="salvaBozza">Salva come bozza</BaseButton>
              <BaseButton @click="esportaProposta">Prepara per un’altra identità</BaseButton>
            </template>
          </div>

          <!--
            The proposal: the same data as the draft, written to a file.
            Whoever imports it sees the files already on Blossom and signs with
            their key — it is the way to have an episode published by the
            podcast's key without that key being in this browser.
          -->
          <BaseField
            v-if="formato === 'podcast'"
            v-slot="{ id, describedBy }"
            label="Per quale chiave è pensata la proposta"
            hint="Facoltativo, npub. Chi importa la proposta con un’altra identità viene avvisato. Non è un vincolo: firma chi importa."
          >
            <BaseInput
              :id="id"
              v-model="perChiaveProposta"
              placeholder="npub1…"
              :described-by="describedBy"
            />
          </BaseField>

          <BaseBadge v-if="bozzaSalvata && formato === 'podcast'" tono="successo">
            bozza salvata ·
            <NuxtLink to="/media/podcast" class="underline">le tue bozze</NuxtLink>
          </BaseBadge>

          <PublishProgress :invio="bozza.invio" />

          <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
          <BaseAlert v-if="erroreEpisodio" tono="pericolo">{{ erroreEpisodio }}</BaseAlert>
        </form>
      </BaseCard>

      <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
        <PublishResult :esito="bozza.invio.esito.value" />
      </BaseCard>

      <BaseCard v-if="bozza.template.value" title="Evento">
        <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
      </BaseCard>
    </ClientOnly>

    <BaseAlert v-if="formato === 'podcast'" tono="info">
      Un episodio dichiara l’audio con il tag
      <code>audio</code>
      , come vuole NIP-F4: senza impronta né dimensione. Chi ascolta non può verificare che il file
      sia quello pubblicato. È la specifica, non una scelta di questo client.
    </BaseAlert>
    <BaseAlert v-else tono="info">
      L’evento porta l’impronta SHA-256 di ogni file: chi lo legge può verificare che quello che
      scarica sia esattamente quello che hai pubblicato. È anche il motivo per cui replicare su più
      server è gratuito — lo stesso file ha lo stesso identificativo ovunque.
    </BaseAlert>
  </div>
</template>
