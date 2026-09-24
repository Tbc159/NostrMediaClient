<script setup lang="ts">
import type { Tag } from '@nmc/nostr-core'

/**
 * I tag dell'evento che il form non governa.
 *
 * Due strade portano qui. La prima: si riapre un evento scritto da un altro
 * client, che porta tag di cui noi non sappiamo nulla — `lat`, `lon`,
 * `place_id`, i colori del tema. Buttarli sarebbe il comportamento peggiore
 * possibile, perche' chi modifica il titolo non si aspetta di perdere il
 * luogo. La seconda: si vuole aggiungere un tag che il client non prevede,
 * `nome-campo: valoreX`, senza aspettare che qualcuno lo implementi.
 *
 * Un tag Nostr e' un array di stringhe, non una coppia: `["c", "#f7f5ed",
 * "background"]` ha due valori e il secondo dice a cosa serve il primo. Per
 * questo ogni posizione ha il suo campo — mostrarne solo la prima
 * significherebbe far modificare all'utente meta' di un dato.
 *
 * Qui non si interpreta nulla e non si giudica: i nomi non hanno un
 * catalogo di «noti» e «sconosciuti», perche' un catalogo sarebbe sempre
 * indietro rispetto a cio' che i client inventano. L'unico avviso riguarda i
 * nomi che il form gia' scrive, dove due tag omonimi renderebbero l'evento
 * ambiguo.
 */

const props = withDefaults(
  defineProps<{
    /** I nomi dei tag che il form compone da solo, per avvisare in caso di collisione. */
    nomiDelForm?: readonly string[]
    /** Da quale evento arrivano: cambia solo il testo introduttivo. */
    daEventoEsistente?: boolean
  }>(),
  { nomiDelForm: () => [], daEventoEsistente: false },
)

const tags = defineModel<Tag[]>({ default: () => [] })

const aperto = ref(false)
const nuovoNome = ref('')
const nuovoValore = ref('')

/** Modifica una posizione di un tag. Si riscrive l'array: Vue segue meglio. */
function scrivi(riga: number, posizione: number, valore: string): void {
  const copia = tags.value.map((t) => [...t])
  const tag = copia[riga]
  if (!tag) return
  tag[posizione] = valore
  tags.value = copia
}

function aggiungiValore(riga: number): void {
  const copia = tags.value.map((t) => [...t])
  copia[riga]?.push('')
  tags.value = copia
}

function togliValore(riga: number, posizione: number): void {
  const copia = tags.value.map((t) => [...t])
  copia[riga]?.splice(posizione, 1)
  tags.value = copia
}

function togli(riga: number): void {
  tags.value = tags.value.filter((_, i) => i !== riga)
}

function aggiungi(): void {
  const nome = nuovoNome.value.trim()
  if (!nome) return
  tags.value = [...tags.value.map((t) => [...t]), [nome, nuovoValore.value.trim()]]
  nuovoNome.value = ''
  nuovoValore.value = ''
  aperto.value = true
}

/** I nomi che il form scrive gia': un omonimo qui renderebbe l'evento ambiguo. */
const inConflitto = computed(() =>
  [
    ...new Set(tags.value.map((t) => t[0] ?? '').filter((n) => props.nomiDelForm.includes(n))),
  ].sort(),
)

const conflitto = (nome: string | undefined): boolean => !!nome && props.nomiDelForm.includes(nome)
</script>

<template>
  <details
    class="superficie rounded-md border p-3"
    :open="aperto"
    @toggle="aperto = ($event.target as HTMLDetailsElement).open"
  >
    <summary class="cursor-pointer text-sm font-medium">
      Tag
      <span class="font-normal text-[var(--testo-tenue)]">
        <template v-if="tags.length">
          — {{ tags.length }} {{ tags.length === 1 ? 'tag' : 'tag' }} oltre a quelli del form
        </template>
        <template v-else>— nessuno oltre a quelli del form</template>
      </span>
    </summary>

    <div class="mt-3 flex flex-col gap-3">
      <p class="text-xs text-[var(--testo-tenue)]">
        <template v-if="daEventoEsistente">
          Questi tag erano nell’evento pubblicato e il form non li compila: vengono ripubblicati
          così come sono. Puoi correggerli o toglierli, ma se non li riconosci lasciali stare — è
          roba del client che ha creato l’evento.
        </template>
        <template v-else>
          Tag liberi, per quello che il form non prevede: un nome e uno o più valori.
        </template>
      </p>

      <ul v-if="tags.length" class="flex flex-col gap-2">
        <li
          v-for="(tag, riga) in tags"
          :key="`${riga}-${tag[0]}`"
          class="flex flex-wrap items-center gap-2 rounded-md border px-2 py-2"
        >
          <input
            class="superficie w-32 rounded-md border px-2 py-1 font-mono text-xs"
            :value="tag[0]"
            :aria-label="`Nome del tag ${riga + 1}`"
            @input="scrivi(riga, 0, ($event.target as HTMLInputElement).value)"
          />
          <template v-for="(valore, posizione) in tag.slice(1)" :key="posizione">
            <span class="flex items-center gap-1">
              <input
                class="superficie min-w-40 rounded-md border px-2 py-1 text-xs"
                :value="valore"
                :aria-label="`Valore ${posizione + 1} di ${tag[0]}`"
                @input="scrivi(riga, posizione + 1, ($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="tag.length > 2"
                type="button"
                class="text-xs text-[var(--testo-tenue)] underline"
                :aria-label="`Togli il valore ${posizione + 1} di ${tag[0]}`"
                @click="togliValore(riga, posizione + 1)"
              >
                ×
              </button>
            </span>
          </template>
          <button
            type="button"
            class="text-xs underline"
            :aria-label="`Aggiungi un valore a ${tag[0]}`"
            @click="aggiungiValore(riga)"
          >
            + valore
          </button>
          <BaseBadge v-if="conflitto(tag[0])" tono="avviso">anche nel form</BaseBadge>
          <button type="button" class="ml-auto text-xs underline" @click="togli(riga)">
            togli
          </button>
        </li>
      </ul>

      <BaseAlert v-if="inConflitto.length" tono="avviso">
        {{ inConflitto.join(', ') }}
        {{ inConflitto.length === 1 ? 'è un tag' : 'sono tag' }} che il form scrive già: l’evento
        uscirebbe con due tag con lo stesso nome, e chi lo legge terrà il primo — quello del form.
        Meglio correggere il campo qui sopra e togliere questa riga.
      </BaseAlert>

      <div class="flex flex-wrap items-end gap-2">
        <label class="flex flex-col gap-1 text-xs">
          <span class="font-medium">Nome</span>
          <input
            v-model="nuovoNome"
            class="superficie w-32 rounded-md border px-2 py-1 font-mono text-xs"
            placeholder="nome-campo"
            @keydown.enter.prevent="aggiungi"
          />
        </label>
        <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs">
          <span class="font-medium">Valore</span>
          <input
            v-model="nuovoValore"
            class="superficie w-full rounded-md border px-2 py-1 text-xs"
            placeholder="valoreX"
            @keydown.enter.prevent="aggiungi"
          />
        </label>
        <BaseButton size="sm" :disabled="!nuovoNome.trim()" @click="aggiungi">Aggiungi</BaseButton>
      </div>
    </div>
  </details>
</template>
