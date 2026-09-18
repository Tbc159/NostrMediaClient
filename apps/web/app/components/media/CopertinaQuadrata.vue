<script setup lang="ts">
import { copertinaConforme, uploadBlob, type MisureCopertina } from '@nmc/nostr-core'

/**
 * Campo «copertina»: un URL, con caricamento e ritaglio incorporati.
 *
 * E' lo stesso campo per la scheda del podcast e per l'immagine di un
 * episodio, perche' la regola e' la stessa — quadrata, 1400–3000 px — e il
 * modo di sbagliarla pure. Misura sempre l'immagine corrente (anche da un
 * URL altrui: `naturalWidth` non richiede CORS) e dice se va bene, prima di
 * pubblicare. «Carica» e «Ritaglia» passano dal ritaglio; l'esportato va su
 * Blossom e l'URL finisce nel campo.
 */

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    hint?: string
    required?: boolean
  }>(),
  { hint: undefined, required: false },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  /** Le misure dell'immagine corrente, appena note; `null` se non misurabile. */
  (e: 'misure', m: MisureCopertina | null): void
}>()

const identita = useIdentity()
const config = useClientConfig()
const server = computed(() => config.value.blossomServers[0] ?? null)
const puoCaricare = computed(() => identita.puoFirmare && !!server.value)

const url = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})

// ── Misura dell'immagine corrente ─────────────────────────────────────────
const misure = ref<MisureCopertina | null>(null)
const misurando = ref(false)

watch(
  url,
  (u) => {
    misure.value = null
    if (!u.trim()) {
      emit('misure', null)
      return
    }
    misurando.value = true
    const img = new Image()
    img.onload = () => {
      misure.value = { larghezza: img.naturalWidth, altezza: img.naturalHeight }
      misurando.value = false
      emit('misure', misure.value)
    }
    img.onerror = () => {
      misurando.value = false
      emit('misure', null)
    }
    img.src = u
  },
  { immediate: true },
)

const conforme = computed(() => copertinaConforme(misure.value))
const giudizio = computed(() => {
  const m = misure.value
  if (!m) return null
  if (conforme.value) return `${m.larghezza}×${m.altezza} — va bene per tutte le piattaforme`
  if (m.larghezza !== m.altezza) return `${m.larghezza}×${m.altezza} — non è quadrata`
  if (m.larghezza < 1400) return `${m.larghezza}×${m.altezza} — sotto i 1400 px`
  return `${m.larghezza}×${m.altezza} — sopra i 3000 px`
})

// ── Ritaglio e caricamento ────────────────────────────────────────────────
const sorgenteRitaglio = ref<File | string | null>(null)
const inCorso = ref(false)
const errore = ref<string | null>(null)

function scegliFile(evento: Event): void {
  const target = evento.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  errore.value = null
  sorgenteRitaglio.value = file
}

function ritagliaCorrente(): void {
  if (!url.value.trim()) return
  errore.value = null
  sorgenteRitaglio.value = url.value.trim()
}

async function caricaRitagliata(blob: Blob): Promise<void> {
  const s = server.value
  if (!s || !identita.puoFirmare) return
  inCorso.value = true
  errore.value = null
  try {
    const descrittore = await uploadBlob(s, blob, {
      firma: (t) => identita.firma(t),
      pubkey: identita.pubkey ?? '',
      mime: 'image/jpeg',
      nome: 'copertina.jpg',
    })
    url.value = descrittore.url
    sorgenteRitaglio.value = null
  } catch (e) {
    errore.value = `Copertina non caricata: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    inCorso.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <BaseField v-slot="{ id, describedBy }" :label="label" :hint="hint" :required="required">
      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <BaseInput
            :id="id"
            v-model="url"
            placeholder="https://…/copertina.jpg"
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
            @change="scegliFile"
          />
        </label>
        <BaseButton
          v-if="url.trim() && !conforme"
          size="sm"
          :disabled="!puoCaricare || inCorso"
          @click="ritagliaCorrente"
        >
          Ritaglia
        </BaseButton>
      </div>

      <div v-if="url.trim()" class="mt-2 flex flex-wrap items-center gap-3">
        <img :src="url" alt="" class="h-24 w-24 rounded-md border object-cover" />
        <p class="text-xs">
          <BaseBadge v-if="misurando">misuro…</BaseBadge>
          <BaseBadge v-else-if="giudizio" :tono="conforme ? 'successo' : 'avviso'">
            {{ giudizio }}
          </BaseBadge>
          <BaseBadge v-else tono="avviso">non misurabile: controlla l’indirizzo</BaseBadge>
          <span v-if="giudizio && !conforme" class="mt-1 block text-[var(--testo-tenue)]">
            Apple, Amazon, Spotify e YouTube vogliono un quadrato da 1400 a 3000 px: «Ritaglia» la
            sistema.
          </span>
        </p>
      </div>
    </BaseField>

    <MediaRitaglioImmagine
      v-if="sorgenteRitaglio !== null"
      :sorgente="sorgenteRitaglio"
      @ritagliata="caricaRitagliata"
      @annulla="sorgenteRitaglio = null"
    />

    <BaseAlert v-if="errore" tono="pericolo">{{ errore }}</BaseAlert>
    <p v-if="!puoCaricare" class="text-xs text-[var(--testo-tenue)]">
      Per caricare un’immagine serve una chiave che firmi e un server Blossom nelle impostazioni.
    </p>
  </div>
</template>
