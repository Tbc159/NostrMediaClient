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

const slots = useSlots()
/*
 * Il pie' di pagina compare anche sugli eventi altrui quando il kind offre
 * un'azione propria: rispondere a un invito riguarda proprio gli eventi che
 * non sono tuoi.
 */
const mostraPiede = computed(() => mostraAzione.value || Boolean(slots.azioni))

const spiegazione = ref(false)
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
      <footer
        v-if="mostraPiede"
        class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs"
      >
        <slot name="azioni" />

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

        <p v-if="spiegazione" class="w-full text-[var(--testo-tenue)]">{{ avviso }}</p>
      </footer>
    </ClientOnly>
  </article>
</template>
