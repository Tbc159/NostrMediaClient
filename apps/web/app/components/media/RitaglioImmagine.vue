<script setup lang="ts">
import { COPERTINA_MAX, COPERTINA_MIN, scaricaImmagine } from '@nmc/nostr-core'
import { useMediaManager } from '~/stores/mediamanager'

/**
 * A square crop with a preview, for the covers.
 *
 * Apple, Amazon, Spotify and YouTube want a square between 1400 and 3000 px:
 * any old photo is not one, and asking the user to crop it elsewhere is the
 * way to have wrong covers published. Here the frame is chosen — zoom and drag
 * — and exported at the right size already.
 *
 * No dependencies: it is a `<canvas>` and a few lines of geometry. The output
 * side is the original's shorter side, clamped between 1400 and 3000: below
 * 1400 it is enlarged and that is said, because refusing would be worse (the
 * platform accepts it, blurred; without a cover it accepts nothing).
 *
 * From a URL the image is downloaded first of all: directly when the server
 * allows it, otherwise through the media-manager, which reads it from its own
 * side. Only when it arrives by neither route do we give up, and say so: at
 * that point the file from disk remains.
 */

const props = defineProps<{
  /** A file chosen from disk, or the URL of an already published image. */
  sorgente: File | string
}>()

const emit = defineEmits<{
  /** The exported square, ready to upload, with its side in pixels. */
  (e: 'ritagliata', blob: Blob, lato: number): void
  (e: 'annulla'): void
}>()

const ANTEPRIMA = 320

const servizio = useMediaManager()

const tela = ref<HTMLCanvasElement | null>(null)
const immagine = shallowRef<HTMLImageElement | ImageBitmap | null>(null)
const larghezza = ref(0)
const altezza = ref(0)
const errore = ref<string | null>(null)
const caricamento = ref(true)
/** Where the image came from, when it comes from a URL: it is said only when it went through the service. */
const provenienza = ref<'diretta' | 'servizio' | null>(null)

/** The zoom relative to the frame that holds everything: 1 = the shorter side fills the square. */
const zoom = ref(1)
/** The centre's offset, in the preview's pixels. */
const dx = ref(0)
const dy = ref(0)

const latoUscita = computed(() =>
  Math.round(
    Math.min(COPERTINA_MAX, Math.max(COPERTINA_MIN, Math.min(larghezza.value, altezza.value))),
  ),
)
const troppoPiccola = computed(
  () => larghezza.value > 0 && Math.min(larghezza.value, altezza.value) < COPERTINA_MIN,
)
const giaQuadrata = computed(
  () =>
    larghezza.value > 0 &&
    larghezza.value === altezza.value &&
    larghezza.value >= COPERTINA_MIN &&
    larghezza.value <= COPERTINA_MAX,
)

/** The base scale: the smallest that fits the shorter side into the preview's square. */
const scalaBase = computed(() =>
  larghezza.value ? ANTEPRIMA / Math.min(larghezza.value, altezza.value) : 1,
)

async function carica(): Promise<void> {
  caricamento.value = true
  errore.value = null
  provenienza.value = null
  try {
    if (typeof props.sorgente === 'string') {
      // A canvas drawn from an image without CORS stays «tainted» and cannot
      // be exported: the bytes have to be really read, directly or through the
      // service. When that is not possible we say so and the file from disk remains.
      const scaricata = await scaricaImmagine(props.sorgente, {
        mediaManager: servizio.client,
      })
      provenienza.value = scaricata.via
      immagine.value = await createImageBitmap(scaricata.blob)
    } else {
      immagine.value = await createImageBitmap(props.sorgente)
    }
    larghezza.value = immagine.value.width
    altezza.value = immagine.value.height
    zoom.value = 1
    dx.value = 0
    dy.value = 0
  } catch (e) {
    errore.value =
      typeof props.sorgente === 'string'
        ? `Non riesco a elaborare l’immagine da quell’indirizzo — ${e instanceof Error ? e.message : String(e)} Scegli il file dal disco.`
        : `Immagine non leggibile: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    caricamento.value = false
  }
  // The canvas appears only once loading has finished: it is drawn after, not before.
  await nextTick()
  disegna()
}

/** The source frame (in the original's pixels) corresponding to the preview's square. */
function riquadro(): { x: number; y: number; lato: number } {
  const scala = scalaBase.value * zoom.value
  const lato = ANTEPRIMA / scala
  // The centre starts from the image's centre and moves with the dragging.
  let x = larghezza.value / 2 - lato / 2 - dx.value / scala
  let y = altezza.value / 2 - lato / 2 - dy.value / scala
  // The square never leaves the image.
  x = Math.min(Math.max(0, x), larghezza.value - lato)
  y = Math.min(Math.max(0, y), altezza.value - lato)
  return { x, y, lato }
}

function disegna(): void {
  const c = tela.value
  const img = immagine.value
  if (!c || !img) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const r = riquadro()
  ctx.clearRect(0, 0, ANTEPRIMA, ANTEPRIMA)
  ctx.drawImage(img, r.x, r.y, r.lato, r.lato, 0, 0, ANTEPRIMA, ANTEPRIMA)
}

watch([zoom, dx, dy], disegna)
watch(() => props.sorgente, carica)
onMounted(carica)

// ── Dragging ──────────────────────────────────────────────────────────────
let trascino: { x: number; y: number; dx: number; dy: number } | null = null

function inizia(e: PointerEvent): void {
  trascino = { x: e.clientX, y: e.clientY, dx: dx.value, dy: dy.value }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function muovi(e: PointerEvent): void {
  if (!trascino) return
  dx.value = trascino.dx + (e.clientX - trascino.x)
  dy.value = trascino.dy + (e.clientY - trascino.y)
}
function fine(): void {
  trascino = null
}

async function conferma(): Promise<void> {
  const img = immagine.value
  if (!img) return
  const r = riquadro()
  const uscita = document.createElement('canvas')
  uscita.width = latoUscita.value
  uscita.height = latoUscita.value
  const ctx = uscita.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, r.x, r.y, r.lato, r.lato, 0, 0, uscita.width, uscita.height)
  const blob = await new Promise<Blob | null>((risolvi) =>
    uscita.toBlob(risolvi, 'image/jpeg', 0.92),
  )
  if (!blob) {
    errore.value = 'Non sono riuscito a esportare l’immagine.'
    return
  }
  emit('ritagliata', blob, uscita.width)
}
</script>

<template>
  <div class="superficie flex flex-col gap-3 rounded-lg border p-3">
    <p class="text-sm font-medium">Ritaglia la copertina</p>

    <BaseAlert v-if="errore" tono="pericolo">{{ errore }}</BaseAlert>
    <p v-else-if="caricamento" class="text-sm text-[var(--testo-tenue)]">Leggo l’immagine…</p>

    <template v-else>
      <div class="flex flex-col gap-3 sm:flex-row">
        <!--
          The square is fixed and the image moves underneath: it is easier to
          see what stays inside than to move a frame over a photo.
        -->
        <canvas
          ref="tela"
          :width="ANTEPRIMA"
          :height="ANTEPRIMA"
          class="shrink-0 cursor-grab touch-none rounded-md border active:cursor-grabbing"
          @pointerdown="inizia"
          @pointermove="muovi"
          @pointerup="fine"
          @pointercancel="fine"
        />

        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <BaseField
            v-slot="{ id }"
            label="Zoom"
            hint="Trascina l’anteprima per scegliere cosa resta dentro."
          >
            <BaseRange
              :id="id"
              v-model="zoom"
              :min="1"
              :max="4"
              :step="0.05"
              unita="×"
              estremo-min="tutta l’immagine"
              estremo-max="un dettaglio"
            />
          </BaseField>

          <p class="text-xs text-[var(--testo-tenue)]">
            Originale {{ larghezza }}×{{ altezza }} → esce un quadrato di
            <strong>{{ latoUscita }}×{{ latoUscita }}</strong>
            px, JPEG.
            <span v-if="provenienza === 'servizio'" class="block">
              Scaricata tramite il servizio: il server dell’immagine non la lascia leggere da
              un’altra pagina.
            </span>
          </p>

          <BaseAlert v-if="troppoPiccola" tono="avviso">
            L’originale ha il lato minore sotto i {{ COPERTINA_MIN }} px: verrà ingrandito a
            {{ COPERTINA_MIN }} e perderà nitidezza. Le piattaforme la accettano, ma una copertina
            più grande farebbe una figura migliore.
          </BaseAlert>
          <BaseAlert v-else-if="giaQuadrata" tono="info">
            È già un quadrato della misura giusta: puoi confermare così com’è.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton variant="primario" @click="conferma">Usa questa immagine</BaseButton>
            <BaseButton variant="fantasma" @click="emit('annulla')">Annulla</BaseButton>
          </div>
        </div>
      </div>
    </template>

    <div v-if="errore" class="flex gap-2">
      <BaseButton variant="fantasma" @click="emit('annulla')">Chiudi</BaseButton>
    </div>
  </div>
</template>
