<script setup lang="ts">
import { toNpub, type NostrEvent } from '@nmc/nostr-core'

/** Intestazione e cornice comuni a tutte le schede evento. */
const props = withDefaults(
  defineProps<{
    evento: NostrEvent
    etichetta?: string
    /** Se offrire l'azione di modifica. Falso dove l'evento e' gia' in un form. */
    azioni?: boolean
  }>(),
  { azioni: true, etichetta: undefined },
)

const identita = useIdentity()

const npub = computed(() => {
  try {
    return toNpub(props.evento.pubkey)
  } catch {
    // Pubkey malformata: mostriamo l'esadecimale invece di nascondere l'evento.
    return props.evento.pubkey
  }
})

const quando = computed(() => new Date(props.evento.created_at * 1000))
const relativo = computed(() => tempoRelativo(quando.value))

const azione = computed(() => azionePerEvento(props.evento))

/*
 * L'azione compare solo sui propri eventi: ripubblicare con la coordinata di
 * un altro non lo modifica — ogni coordinata comprende la pubkey dell'autore,
 * quindi si otterrebbe un evento nuovo a proprio nome, che non e' quello che
 * chi clicca "modifica" si aspetta.
 */
const propria = computed(() => identita.pubkey === props.evento.pubkey)
const mostraAzione = computed(() => props.azioni && propria.value)

/*
 * Il pie' di pagina c'e' sempre: «Apri in…» vale per qualunque evento, anche
 * altrui, mentre le azioni di modifica restano riservate ai propri.
 */

const spiegazione = ref(false)

/*
 * Il JSON con cui l'evento e' pubblicato, dentro la scheda, richiudibile.
 *
 * E' l'unica rappresentazione *vera* di cio' che sta sui relay — tag, firma,
 * id — e chi pubblica ha il diritto di vederla senza cambiare pagina ne'
 * client. Chiuso di default: aperto, mostra il testo in un'area a sola
 * lettura che si seleziona con un clic e si incolla altrove.
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
    // Appunti negati: resta «seleziona tutto».
  }
}

function selezionaJson(): void {
  areaJson.value?.focus()
  areaJson.value?.select()
}

/*
 * Ridistribuire: lo stesso evento, gia' firmato, mandato ai relay di
 * scrittura di adesso. Non si rifirma — l'id resta quello — quindi non nasce
 * un duplicato: un relay che l'ha gia' risponde «gia' presente». Serve quando
 * un evento e' finito su un relay solo e chi deve leggerlo guarda altrove: un
 * lettore di podcast che legge da un relay dove la scheda non c'e' mai stata.
 */
const invio = usePublish()
const ridistribuito = ref<string | null>(null)

async function ridistribuisci(): Promise<void> {
  ridistribuito.value = null
  // Sempre «tutti»: il senso e' proprio metterlo ovunque, non sul primo che accetta.
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
// Il tipo 'modifica' non porta un avviso: il template non puo' restringere
// l'unione da solo, quindi la si appiattisce qui.
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
          Sempre presente, anche sugli eventi altrui: guardare come appare una
          pubblicazione in un altro client e' utile a prescindere da chi l'ha
          scritta.
        -->
        <!--
          Il nome comprende il prefisso della cartella: Nuxt ricava il nome del
          componente dal percorso, e `<ApriEsterno>` verrebbe reso come un
          elemento sconosciuto, senza errori e senza funzionare.
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
            Una textarea in sola lettura, non un <pre>: si seleziona tutto con
            un clic e su telefono scorre senza rompere la scheda. La firma
            copre ogni byte, quindi non si modifica.
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
