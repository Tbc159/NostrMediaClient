<script setup lang="ts">
import type { DestinatarioValore, Persona, TipoPodcast, Valore } from '@nmc/nostr-core'

/**
 * What the feed needs beyond NIP-F4: how it signs, how it orders, whom the
 * boosts go to, where to support the show, who makes it.
 *
 * NIP-F4 has no field for these; they sit in the 10154 as simple tags that the
 * feed's service turns back into `itunes:author`, `itunes:type`,
 * `podcast:value`, `podcast:funding` and `podcast:person`. One row per entry,
 * like the extra tags: a split or a list of people is a table, not a sentence.
 */

const autore = defineModel<string>('autore', { default: '' })
const tipo = defineModel<TipoPodcast>('tipo', { default: 'episodic' })
const valore = defineModel<Valore | undefined>('valore', { default: undefined })
const finanziamenti = defineModel<{ url: string; testo?: string }[]>('finanziamenti', {
  default: () => [],
})
const persone = defineModel<Persona[]>('persone', { default: () => [] })

defineProps<{
  /** The profile's name, offered when the author is empty. */
  nomeProfilo?: string | null
}>()

const tipi = [
  { value: 'episodic', label: 'Episodico: dal più recente' },
  { value: 'serial', label: 'Seriale: dal primo, in ordine' },
]
const tipiDestinatario = [
  { value: 'lnaddress', label: 'Lightning address' },
  { value: 'node', label: 'Nodo (keysend)' },
]
const ruoli = ['host', 'cohost', 'guest', 'producer', 'editor', 'composer', 'cover art designer']

// ── the split ────────────────────────────────────────────────────────────
const destinatari = computed(() => valore.value?.destinatari ?? [])
const totaleQuote = computed(() => destinatari.value.reduce((t, d) => t + d.quota, 0))

function scriviDestinatari(nuovi: DestinatarioValore[]): void {
  valore.value = nuovi.length
    ? {
        tipo: valore.value?.tipo ?? 'lightning',
        metodo: valore.value?.metodo ?? 'keysend',
        ...(valore.value?.suggerito ? { suggerito: valore.value.suggerito } : {}),
        destinatari: nuovi,
      }
    : undefined
}
function aggiornaDestinatario(i: number, campo: Partial<DestinatarioValore>): void {
  scriviDestinatari(destinatari.value.map((d, k) => (k === i ? { ...d, ...campo } : d)))
}
function aggiungiDestinatario(): void {
  scriviDestinatari([
    ...destinatari.value,
    {
      nome: '',
      tipo: 'lnaddress',
      indirizzo: '',
      quota: destinatari.value.length ? 1 : 100,
      fee: false,
    },
  ])
}
function togliDestinatario(i: number): void {
  scriviDestinatari(destinatari.value.filter((_, k) => k !== i))
}
const percentuale = (q: number): string =>
  totaleQuote.value ? `${Math.round((q / totaleQuote.value) * 100)}%` : ''

// ── funding and people ───────────────────────────────────────────────────
function aggiornaFinanziamento(i: number, campo: Partial<{ url: string; testo: string }>): void {
  finanziamenti.value = finanziamenti.value.map((f, k) => (k === i ? { ...f, ...campo } : f))
}
function aggiornaPersona(i: number, campo: Partial<Persona>): void {
  persone.value = persone.value.map((p, k) => (k === i ? { ...p, ...campo } : p))
}
const valoreInput = (e: Event): string => (e.target as HTMLInputElement).value
</script>

<template>
  <details class="superficie rounded-md border p-3">
    <summary class="cursor-pointer text-sm font-medium">
      Feed: autore, ordine, boost, sostegno e persone
    </summary>
    <div class="mt-3 flex flex-col gap-4 text-sm">
      <div class="grid gap-3 sm:grid-cols-2">
        <BaseField
          v-slot="{ id, describedBy }"
          label="Autore nel feed"
          hint="Come firma il feed (itunes:author). Vuoto: il nome del profilo."
        >
          <BaseInput
            :id="id"
            v-model="autore"
            :described-by="describedBy"
            :placeholder="nomeProfilo ?? ''"
          />
        </BaseField>
        <BaseField
          v-slot="{ id, describedBy }"
          label="Tipo"
          hint="Seriale: le app propongono gli episodi dal primo."
        >
          <BaseSelect :id="id" v-model="tipo" :options="tipi" :described-by="describedBy" />
        </BaseField>
      </div>

      <!-- ── value ── -->
      <div class="flex flex-col gap-2">
        <p class="font-medium">
          Ripartizione dei boost Lightning
          <span class="font-normal text-[var(--testo-tenue)]">
            — a chi Fountain e gli altri lettori mandano i sat
          </span>
        </p>
        <div
          v-for="(d, i) in destinatari"
          :key="i"
          class="superficie grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto_2fr_5rem_auto]"
        >
          <input
            :value="d.nome"
            :aria-label="`Nome del destinatario ${i + 1}`"
            placeholder="Nome"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaDestinatario(i, { nome: valoreInput($event) })"
          />
          <select
            :value="d.tipo"
            :aria-label="`Tipo del destinatario ${i + 1}`"
            class="superficie rounded-md border px-2 py-1"
            @change="aggiornaDestinatario(i, { tipo: valoreInput($event) })"
          >
            <option v-for="t in tipiDestinatario" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </select>
          <input
            :value="d.indirizzo"
            :aria-label="`Indirizzo del destinatario ${i + 1}`"
            :placeholder="d.tipo === 'node' ? 'chiave pubblica del nodo' : 'nome@wallet.com'"
            class="superficie rounded-md border px-2 py-1 font-mono text-xs"
            @input="aggiornaDestinatario(i, { indirizzo: valoreInput($event) })"
          />
          <input
            :value="d.quota"
            type="number"
            min="1"
            step="1"
            :aria-label="`Quota del destinatario ${i + 1}`"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaDestinatario(i, { quota: Number(valoreInput($event)) })"
          />
          <span class="flex items-center gap-2 text-xs">
            {{ percentuale(d.quota) }}
            <button
              type="button"
              class="underline"
              :aria-label="`Togli ${d.nome || 'il destinatario'}`"
              @click="togliDestinatario(i)"
            >
              togli
            </button>
          </span>
        </div>
        <p v-if="destinatari.length" class="text-xs text-[var(--testo-tenue)]">
          Quote totali: {{ totaleQuote }}. Sono proporzioni, non percentuali: contano i rapporti.
        </p>
        <BaseButton size="sm" class="w-fit" @click="aggiungiDestinatario">
          Aggiungi un destinatario
        </BaseButton>
      </div>

      <!-- ── funding ── -->
      <div class="flex flex-col gap-2">
        <p class="font-medium">Dove sostenere lo show</p>
        <div
          v-for="(f, i) in finanziamenti"
          :key="i"
          class="grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
        >
          <input
            :value="f.url"
            :aria-label="`Link di sostegno ${i + 1}`"
            placeholder="https://…"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaFinanziamento(i, { url: valoreInput($event) })"
          />
          <input
            :value="f.testo ?? ''"
            :aria-label="`Testo del link di sostegno ${i + 1}`"
            placeholder="Sostienici"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaFinanziamento(i, { testo: valoreInput($event) })"
          />
          <button
            type="button"
            class="text-xs underline"
            @click="finanziamenti = finanziamenti.filter((_, k) => k !== i)"
          >
            togli
          </button>
        </div>
        <BaseButton
          size="sm"
          class="w-fit"
          @click="finanziamenti = [...finanziamenti, { url: '', testo: '' }]"
        >
          Aggiungi un link
        </BaseButton>
      </div>

      <!-- ── people ── -->
      <div class="flex flex-col gap-2">
        <p class="font-medium">Persone</p>
        <div
          v-for="(p, i) in persone"
          :key="i"
          class="superficie grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto_1fr_1fr_auto]"
        >
          <input
            :value="p.nome"
            :aria-label="`Nome della persona ${i + 1}`"
            placeholder="Nome"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaPersona(i, { nome: valoreInput($event) })"
          />
          <select
            :value="p.ruolo ?? 'host'"
            :aria-label="`Ruolo della persona ${i + 1}`"
            class="superficie rounded-md border px-2 py-1"
            @change="aggiornaPersona(i, { ruolo: valoreInput($event) })"
          >
            <option v-for="r in ruoli" :key="r" :value="r">{{ r }}</option>
          </select>
          <input
            :value="p.immagine ?? ''"
            :aria-label="`Immagine della persona ${i + 1}`"
            placeholder="Immagine (URL)"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaPersona(i, { immagine: valoreInput($event) })"
          />
          <input
            :value="p.link ?? ''"
            :aria-label="`Link della persona ${i + 1}`"
            placeholder="Link"
            class="superficie rounded-md border px-2 py-1"
            @input="aggiornaPersona(i, { link: valoreInput($event) })"
          />
          <button
            type="button"
            class="text-xs underline"
            @click="persone = persone.filter((_, k) => k !== i)"
          >
            togli
          </button>
        </div>
        <BaseButton
          size="sm"
          class="w-fit"
          @click="persone = [...persone, { nome: '', ruolo: 'host' }]"
        >
          Aggiungi una persona
        </BaseButton>
      </div>
    </div>
  </details>
</template>
