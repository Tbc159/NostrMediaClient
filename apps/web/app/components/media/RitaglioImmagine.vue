<script setup lang="ts">
import { COPERTINA_MAX, COPERTINA_MIN, scaricaImmagine } from '@nmc/nostr-core'
import { useMediaManager } from '~/stores/mediamanager'

/**
 * Ritaglio quadrato con anteprima, per le copertine.
 *
 * Apple, Amazon, Spotify e YouTube vogliono un quadrato fra 1400 e 3000 px:
 * una foto qualunque non lo e', e chiedere all'utente di ritagliarla altrove
 * e' il modo per far pubblicare copertine sbagliate. Qui si sceglie il
 * riquadro — zoom e trascinamento — e si esporta gia' alla misura giusta.
 *
 * Nessuna dipendenza: e' un `<canvas>` e poche righe di geometria. Il lato
 * di uscita e' il lato minore dell'originale, stretto fra 1400 e 3000: sotto
 * i 1400 si ingrandisce e lo si dice, perche' rifiutare sarebbe peggio (la
 * piattaforma la accetta, ma sfocata; senza copertina non accetta nulla).
 *
 * Da un URL l'immagine si scarica prima di tutto: direttamente se il server
 * lo consente, altrimenti tramite il media-manager, che la legge dal suo
 * lato. Solo se non arriva in nessuno dei due modi si rinuncia, e lo si
 * dice: a quel punto resta il file dal disco.
 */

const props = defineProps<{
  /** Un file scelto dal disco, oppure l'URL di un'immagine gia' pubblicata. */
  sorgente: File | string
}>()

const emit = defineEmits<{
  /** Il quadrato esportato, pronto da caricare, con il lato in pixel. */
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
/** Da dove e' arrivata l'immagine, quando viene da un URL: si dice solo se e' passata dal servizio. */
const provenienza = ref<'diretta' | 'servizio' | null>(null)

/** Zoom relativo al riquadro che contiene tutto: 1 = il lato minore riempie il quadrato. */
const zoom = ref(1)
/** Spostamento del centro, in pixel dell'anteprima. */
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

/** Scala base: la piu' piccola che fa entrare il lato minore nel quadrato dell'anteprima. */
const scalaBase = computed(() =>
  larghezza.value ? ANTEPRIMA / Math.min(larghezza.value, altezza.value) : 1,
)

async function carica(): Promise<void> {
  caricamento.value = true
  errore.value = null
  provenienza.value = null
  try {
    if (typeof props.sorgente === 'string') {
      // Una tela disegnata da un'immagine senza CORS resta «sporca» e non si
      // esporta: i byte vanno letti davvero, direttamente o tramite il
      // servizio. Se non si puo', si dice e resta il file dal disco.
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
  // La tela compare solo a caricamento finito: si disegna dopo, non prima.
  await nextTick()
  disegna()
}

/** Il riquadro sorgente (in pixel dell'originale) corrispondente al quadrato dell'anteprima. */
function riquadro(): { x: number; y: number; lato: number } {
  const scala = scalaBase.value * zoom.value
  const lato = ANTEPRIMA / scala
  // Il centro parte dal centro dell'immagine e si sposta con il trascinamento.
  let x = larghezza.value / 2 - lato / 2 - dx.value / scala
  let y = altezza.value / 2 - lato / 2 - dy.value / scala
  // Il quadrato non esce mai dall'immagine.
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

// ── Trascinamento ─────────────────────────────────────────────────────────
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
          Il quadrato e' fisso e l'immagine si muove sotto: e' piu' facile
          capire cosa resta dentro che spostare una cornice su una foto.
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
