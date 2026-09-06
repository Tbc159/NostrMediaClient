<script setup lang="ts">
import {
  clientEsterniPredefiniti,
  clientPerEvento,
  linkEventoEsterno,
  type NostrEvent,
} from '@nmc/nostr-core'

/**
 * Apre un evento nel client di lettura scelto dall'utente.
 *
 * Questo client serve a gestire i propri contenuti; per vederli come li vede
 * il resto della rete serve un client di lettura, e quale sia dipende da dove
 * ci si trova. La scelta e' applicata in base a **come si sta interagendo**,
 * non a un'impostazione da ricordare: puntatore grossolano e assenza di hover
 * significano telefono, e li' si apre l'app.
 */
const props = defineProps<{ evento: NostrEvent }>()

const configurazione = useConfigurazione()
const config = useClientConfigSafe()
const { piattaforma } = useDispositivo()

const scelto = computed(() => configurazione.visualizzatorePer(piattaforma.value))

/**
 * Il client scelto, oppure un ripiego se quello scelto non mostra questo kind.
 *
 * Nessun client di lettura li conosce tutti, e la conseguenza non e' un
 * dettaglio estetico: noStrudel apre un evento da calendario sotto la scritta
 * «Unknown event kind», senza data ne' luogo. Portarci l'utente sarebbe
 * peggio che non offrire il pulsante.
 */
const risolto = computed(() =>
  clientPerEvento(scelto.value, props.evento, [
    ...clientEsterniPredefiniti,
    ...configurazione.visualizzatoriPersonali,
  ]),
)
const client = computed(() => risolto.value.client)

/**
 * Relay da suggerire dentro l'identificatore.
 *
 * Si passano quelli di **scrittura**: sono quelli su cui l'evento e'
 * effettivamente finito. Suggerire i relay di lettura manderebbe il client
 * esterno a cercarlo dove non e' mai stato pubblicato.
 */
const suggerimenti = computed(() => config.value.valore?.writeRelays ?? [])

const link = computed(() => {
  try {
    return linkEventoEsterno(client.value, props.evento, suggerimenti.value)
  } catch {
    // Modello rotto: meglio nascondere il pulsante che offrirne uno inerte.
    return null
  }
})

/** Lo schema nostr: non e' una pagina web: aprirlo in una scheda nuova non ha senso. */
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
