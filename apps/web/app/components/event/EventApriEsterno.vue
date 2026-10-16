<script setup lang="ts">
import {
  clientEsterniPredefiniti,
  clientPerEvento,
  linkEventoEsterno,
  type NostrEvent,
} from '@nmc/nostr-core'

/**
 * Opens an event in the reading client the user chose.
 *
 * This client is for managing your own content; to see it as the rest of the
 * network sees it you need a reading client, and which one depends on where
 * you are. The choice is applied according to **how you are interacting**, not
 * to a setting you have to remember: a coarse pointer and the absence of hover
 * mean a phone, and there the app is what opens.
 */
const props = defineProps<{ evento: NostrEvent }>()

const configurazione = useConfigurazione()
const config = useClientConfigSafe()
const { piattaforma } = useDispositivo()

const scelto = computed(() => configurazione.visualizzatorePer(piattaforma.value))

/**
 * The chosen client, or a fallback when the chosen one does not display this
 * kind.
 *
 * No reading client knows them all, and the consequence is not an aesthetic
 * detail: noStrudel opens a calendar event under the words «Unknown event
 * kind», with no date and no place. Taking the user there would be worse than
 * not offering the button.
 */
const risolto = computed(() =>
  clientPerEvento(scelto.value, props.evento, [
    ...clientEsterniPredefiniti,
    ...configurazione.visualizzatoriPersonali,
  ]),
)
const client = computed(() => risolto.value.client)

/**
 * The relays to suggest inside the identifier.
 *
 * The **write** ones are passed: they are the ones the event actually ended up
 * on. Suggesting the read relays would send the external client looking for it
 * where it was never published.
 */
const suggerimenti = computed(() => config.value.valore?.writeRelays ?? [])

const link = computed(() => {
  try {
    return linkEventoEsterno(client.value, props.evento, suggerimenti.value)
  } catch {
    // A broken template: better to hide the button than to offer an inert one.
    return null
  }
})

/** The nostr: scheme is not a web page: opening it in a new tab makes no sense. */
const schemaApp = computed(() => link.value?.startsWith('nostr:') ?? false)
</script>

<template>
  <a
    v-if="link"
    :href="link"
    :target="schemaApp ? undefined : '_blank'"
    :rel="schemaApp ? undefined : 'noopener noreferrer'"
    class="underline"
    :title="
      risolto.sostituito
        ? `${risolto.sostituito.nome} non mostra questo tipo di evento: si apre in ${client.nome}`
        : `Apre questo evento in ${client.nome}`
    "
  >
    Apri in {{ client.nome }}
    <span aria-hidden="true">{{ schemaApp ? '' : ' ↗' }}</span>
  </a>
</template>
