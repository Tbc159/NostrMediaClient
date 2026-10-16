<script setup lang="ts">
import { toNpub, type NostrEvent } from '@nmc/nostr-core'

/** The heading and frame common to every event card. */
const props = withDefaults(
  defineProps<{
    evento: NostrEvent
    etichetta?: string
    /** Whether to offer the edit action. False where the event is in a form already. */
    azioni?: boolean
  }>(),
  { azioni: true, etichetta: undefined },
)

const identita = useIdentity()

const npub = computed(() => {
  try {
    return toNpub(props.evento.pubkey)
  } catch {
    // A malformed pubkey: we show the hexadecimal instead of hiding the event.
    return props.evento.pubkey
  }
})

const quando = computed(() => new Date(props.evento.created_at * 1000))
const relativo = computed(() => tempoRelativo(quando.value))

const azione = computed(() => azionePerEvento(props.evento))

/*
 * The action appears on your own events alone: republishing with somebody
 * else's coordinate does not edit it — every coordinate includes the author's
 * pubkey, so you would get a new event in your own name, which is not what
 * whoever clicks "edit" expects.
 */
const propria = computed(() => identita.pubkey === props.evento.pubkey)
const mostraAzione = computed(() => props.azioni && propria.value)

/*
 * The footer is always there: «Open in…» holds for any event at all, other
 * people's included, while the editing actions stay reserved for your own.
 */

const spiegazione = ref(false)

/*
 * The JSON the event is published as, inside the card, collapsible.
 *
 * It is the only *true* representation of what sits on the relays — tags,
 * signature, id — and whoever publishes has the right to see it without
 * changing page or client. Closed by default: open, it shows the text in a
 * read-only area that is selected with one click and pasted elsewhere.
 */
const mostraJson = ref(false)
const json = computed(() => JSON.stringify(props.evento, null, 2))
const areaJson = ref<HTMLTextAreaElement | null>(null)
const copiato = ref(false)

async function copiaJson(): Promise<void> {
  try {
    await navigator.clipboard.writeText(json.value)
    copiato.value = true
    setTimeout(() => (copiato.value = false), 1500)
  } catch {
    // Clipboard denied: «select all» remains.
  }
}

function selezionaJson(): void {
  areaJson.value?.focus()
  areaJson.value?.select()
}

/*
 * Redistributing: the same event, already signed, sent to the write relays of
 * now. It is not re-signed — the id stays as it was — so no duplicate is born:
 * a relay that has it already answers «there already». It is needed when an
 * event has ended up on a single relay and whoever has to read it is looking
 * elsewhere: a podcast player reading from a relay the card has never been on.
 */
const invio = usePublish()
const ridistribuito = ref<string | null>(null)

async function ridistribuisci(): Promise<void> {
  ridistribuito.value = null
  // Always «all»: the point is precisely to put it everywhere, not on the first that accepts.
  await invio.pubblica(props.evento, undefined, { strategia: 'tutti' })
  const r = invio.esito.value
  if (!r) return
  const ok = r.risultati.filter((x) => x.esito === 'accettato' || x.esito === 'duplicato')
  const ko = r.risultati.filter((x) => !ok.includes(x))
  ridistribuito.value =
    `Ora su ${ok.length} relay` +
    (ko.length
      ? `; rifiutato da ${ko.map((x) => `${x.url.replace(/^wss?:\/\//, '')} (${x.motivo})`).join(', ')}`
      : '') +
    '.'
}
// The 'modifica' type carries no warning: the template cannot narrow the
// union by itself, so it is flattened here.
const avviso = computed(() => ('avviso' in azione.value ? azione.value.avviso : ''))
</script>

<template>
  <article class="superficie rounded-xl border p-4">
    <header class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <code class="text-[var(--testo-tenue)]">{{ npub.slice(0, 16) }}…</code>
      <time :datetime="quando.toISOString()" :title="quando.toLocaleString('it-IT')">
        {{ relativo }}
      </time>
      <BaseBadge v-if="etichetta" class="ml-auto">{{ etichetta }}</BaseBadge>
    </header>

    <slot />

    <ClientOnly>
      <footer class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
        <slot name="azioni" />

        <!--
          Always present, on other people's events too: looking at how a
          publication appears in another client is useful regardless of who
          wrote it.
        -->
        <!--
          The name includes the folder's prefix: Nuxt derives the component's
          name from the path, and `<ApriEsterno>` would be rendered as an
          unknown element, with no errors and without working.
        -->
        <EventApriEsterno :evento="evento" />

        <NuxtLink
          v-if="mostraAzione && azione.tipo === 'modifica'"
          :to="azione.rotta"
          class="font-medium text-[var(--accento)] underline"
        >
          {{ azione.etichetta }} →
        </NuxtLink>

        <template v-else-if="mostraAzione && azione.tipo === 'ripubblica'">
          <NuxtLink :to="azione.rotta" class="underline">{{ azione.etichetta }} →</NuxtLink>
          <button
            type="button"
            class="text-[var(--testo-tenue)] underline"
            :aria-expanded="spiegazione"
            @click="spiegazione = !spiegazione"
          >
            perché non si modifica
          </button>
        </template>

        <button
          v-else-if="mostraAzione"
          type="button"
          class="text-[var(--testo-tenue)] underline"
          :aria-expanded="spiegazione"
          @click="spiegazione = !spiegazione"
        >
          non modificabile — perché
        </button>

        <button
          v-if="propria"
          type="button"
          class="underline"
          :disabled="invio.inCorso.value"
          title="Manda questo stesso evento, già firmato, a tutti i relay di scrittura: niente duplicati, chi ce l’ha già lo dice."
          @click="ridistribuisci"
        >
          {{ invio.inCorso.value ? 'ridistribuisco…' : 'ridistribuisci sui relay' }}
        </button>

        <button
          type="button"
          class="text-[var(--testo-tenue)] underline"
          :aria-expanded="mostraJson"
          @click="mostraJson = !mostraJson"
        >
          {{ mostraJson ? 'nascondi JSON' : 'JSON' }}
        </button>

        <p v-if="spiegazione" class="w-full text-[var(--testo-tenue)]">{{ avviso }}</p>

        <div v-if="mostraJson" class="flex w-full flex-col gap-2 pt-1">
          <div class="flex flex-wrap items-center gap-2">
            <BaseBadge>kind {{ evento.kind }}</BaseBadge>
            <BaseBadge>{{ evento.tags.length }} tag</BaseBadge>
            <div class="ml-auto flex gap-2">
              <BaseButton size="sm" variant="fantasma" @click="selezionaJson">
                seleziona tutto
              </BaseButton>
              <BaseButton size="sm" @click="copiaJson">
                {{ copiato ? 'copiato' : 'copia JSON' }}
              </BaseButton>
            </div>
          </div>
          <!--
            A read-only textarea, not a <pre>: it is all selected with one
            click and on a phone it scrolls without breaking the card. The
            signature covers every byte, so it is not editable.
          -->
          <textarea
            ref="areaJson"
            readonly
            :value="json"
            :rows="Math.min(24, json.split('\n').length + 1)"
            spellcheck="false"
            class="superficie w-full rounded-lg border p-3 font-mono text-xs leading-relaxed"
          />
        </div>
        <p v-if="ridistribuito" class="w-full text-[var(--testo-tenue)]">{{ ridistribuito }}</p>
        <p v-if="invio.errore.value" class="w-full text-[var(--pericolo)]">
          {{ invio.errore.value }}
        </p>
      </footer>
    </ClientOnly>
  </article>
</template>
