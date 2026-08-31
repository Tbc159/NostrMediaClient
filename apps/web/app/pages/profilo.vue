<script setup lang="ts">
import { getKindDefinition } from '@nmc/nostr-core'

useHead({ title: 'Profilo · NostrMediaClient' })

const identita = useIdentity()
const bozza = useEventDraft()
const esistente = useEventoEsistente()

const nome = ref('')
const nomeVisualizzato = ref('')
const descrizione = ref('')
const immagine = ref('')
const copertina = ref('')
const sito = ref('')
const nip05 = ref('')
const lud16 = ref('')
const bot = ref(false)

/** Vero quando si e' partiti da un profilo gia' pubblicato. */
const daPubblicato = ref(false)

/**
 * Il profilo e' **replaceable**: esiste una sola versione per pubkey, e
 * ripubblicarlo sostituisce quella precedente per intero.
 *
 * Da qui la conseguenza che rende obbligatorio caricare prima: un campo
 * lasciato vuoto non resta com'era, **sparisce**. Pubblicare un profilo
 * composto da zero cancellerebbe tutto quello che c'e' gia'.
 */
async function carica(): Promise<void> {
  const trovato = await esistente.perCoordinata(0)
  if (!trovato) return

  const definizione = getKindDefinition(0)
  if (!definizione) return

  try {
    const dati = definizione.parse(trovato)
    nome.value = dati.name ?? ''
    nomeVisualizzato.value = dati.display_name ?? ''
    descrizione.value = dati.about ?? ''
    immagine.value = dati.picture ?? ''
    copertina.value = dati.banner ?? ''
    sito.value = dati.website ?? ''
    nip05.value = dati.nip05 ?? ''
    lud16.value = dati.lud16 ?? ''
    bot.value = dati.bot === true
    daPubblicato.value = true
  } catch (e) {
    esistente.errore.value = `Il profilo pubblicato non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

onMounted(() => {
  if (identita.pubkey) {
    void carica()
    void caricaPodcast()
  }
})
watch(
  () => identita.pubkey,
  () => identita.pubkey && carica(),
)

function componi(): void {
  const definizione = getKindDefinition(0)
  if (!definizione) {
    bozza.errore.value = 'Kind 0 non registrato.'
    return
  }

  // I campi vuoti non vengono scritti: la definizione li scarta, e un campo
  // presente ma vuoto verrebbe letto come "impostato a niente".
  bozza.costruisci(definizione, {
    name: nome.value.trim() || undefined,
    display_name: nomeVisualizzato.value.trim() || undefined,
    about: descrizione.value.trim() || undefined,
    picture: immagine.value.trim() || undefined,
    banner: copertina.value.trim() || undefined,
    website: sito.value.trim() || undefined,
    nip05: nip05.value.trim() || undefined,
    lud16: lud16.value.trim() || undefined,
    bot: bot.value || undefined,
  })
}

// ─── Podcast (NIP-F4) ──────────────────────────────────────────────────────
/*
 * Sta qui e non nella sezione media perche' NIP-F4 modella ogni podcast come
 * una *chiave a se'*: la scheda dello show appartiene all'identita', non a un
 * singolo episodio. I lettori di podcast leggono questa e possono ignorare del
 * tutto il kind 0.
 */
const bozzaPodcast = useEventDraft()
const podcastEsistente = useEventoEsistente()

const podcastTitolo = ref('')
const podcastDescrizione = ref('')
const podcastImmagine = ref('')
const podcastSito = ref('')
const haPodcast = ref(false)
const mostraPodcast = ref(false)

async function caricaPodcast(): Promise<void> {
  const trovato = await podcastEsistente.perCoordinata(10154)
  if (!trovato) return
  const definizione = getKindDefinition(10154)
  if (!definizione) return
  try {
    const dati = definizione.parse(trovato)
    podcastTitolo.value = dati.title
    podcastDescrizione.value = dati.description ?? ''
    podcastImmagine.value = dati.image ?? ''
    podcastSito.value = dati.websites[0] ?? ''
    haPodcast.value = true
    mostraPodcast.value = true
  } catch {
    // Scheda malformata: si lascia il form vuoto invece di bloccare il profilo.
  }
}

function componiPodcast(): void {
  const definizione = getKindDefinition(10154)
  if (!definizione) {
    bozzaPodcast.errore.value = 'Kind 10154 non registrato.'
    return
  }
  bozzaPodcast.costruisci(definizione, {
    title: podcastTitolo.value.trim(),
    ...(podcastDescrizione.value.trim() ? { description: podcastDescrizione.value.trim() } : {}),
    ...(podcastImmagine.value.trim() ? { image: podcastImmagine.value.trim() } : {}),
    ...(podcastSito.value.trim() ? { websites: [podcastSito.value.trim()] } : {}),
  })
}

const campi = [
  { modello: 'nome', label: 'Nome breve', hint: 'Senza spazi, come uno username.' },
  { modello: 'nomeVisualizzato', label: 'Nome visualizzato', hint: 'Come vuoi comparire.' },
  { modello: 'immagine', label: 'Immagine', hint: 'URL. Puoi caricarla dalla sezione media.' },
  { modello: 'copertina', label: 'Copertina', hint: 'URL dell’immagine di sfondo.' },
  { modello: 'sito', label: 'Sito', hint: '' },
  { modello: 'nip05', label: 'Identificatore NIP-05', hint: 'Nella forma nome@dominio.tld.' },
  { modello: 'lud16', label: 'Indirizzo Lightning', hint: 'Per ricevere zap.' },
] as const

const valori = { nome, nomeVisualizzato, immagine, copertina, sito, nip05, lud16 }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Il tuo profilo</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 0 — sostituibile.</p>
      </div>
      <BaseButton to="/" variant="fantasma">← Torna agli eventi</BaseButton>
    </div>

    <ClientOnly>
      <SenzaIdentita v-if="!identita.autenticato" cosa="il profilo" />

      <template v-else>
        <div
          v-if="esistente.caricamento.value"
          class="superficie h-16 animate-pulse rounded-xl border"
        />
        <BaseAlert v-if="esistente.errore.value" tono="avviso">
          {{ esistente.errore.value }}
        </BaseAlert>

        <BaseAlert tono="avviso">
          Il profilo sostituisce per intero la versione precedente: un campo lasciato vuoto
          <strong>non resta com’era, sparisce</strong>
          .
          <template v-if="!daPubblicato">
            Qui non è stato caricato nulla dai relay, quindi pubblicando ora sovrascriveresti un
            eventuale profilo esistente con questi soli campi.
          </template>
        </BaseAlert>

        <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
          {{ identita.motivoNonFirmabile }}
          <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
          .
        </BaseAlert>

        <BaseCard>
          <form class="flex flex-col gap-4" @submit.prevent="componi">
            <BaseField
              v-for="c in campi"
              :key="c.modello"
              v-slot="{ id, describedBy }"
              :label="c.label"
              :hint="c.hint || undefined"
            >
              <BaseInput :id="id" v-model="valori[c.modello].value" :described-by="describedBy" />
            </BaseField>

            <BaseField v-slot="{ id, describedBy }" label="Descrizione">
              <BaseTextarea :id="id" v-model="descrizione" :rows="4" :described-by="describedBy" />
            </BaseField>

            <label class="flex items-center gap-2 text-sm">
              <input v-model="bot" type="checkbox" />
              Dichiara che questo account è un bot
            </label>

            <div class="flex flex-wrap gap-2">
              <BaseButton type="submit" variant="primario">Componi evento</BaseButton>
              <BaseButton
                v-if="bozza.template.value"
                variant="primario"
                :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
                :disabled="!identita.puoFirmare"
                @click="bozza.firmaEPubblica()"
              >
                {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
              </BaseButton>
              <BaseButton variant="fantasma" :loading="esistente.caricamento.value" @click="carica">
                Ricarica dai relay
              </BaseButton>
            </div>

            <PublishProgress :invio="bozza.invio" />

            <BaseAlert v-if="bozza.errore.value" tono="pericolo">
              {{ bozza.errore.value }}
            </BaseAlert>
          </form>
        </BaseCard>

        <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
          <PublishResult :esito="bozza.invio.esito.value" />
        </BaseCard>

        <!-- ─────────── Podcast (NIP-F4) ─────────── -->
        <BaseCard
          title="Podcast"
          subtitle="Kind 10154. Serve solo se pubblichi episodi: i lettori di podcast leggono questa scheda e ignorano il profilo."
        >
          <details
            :open="mostraPodcast"
            @toggle="mostraPodcast = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="cursor-pointer text-sm">
              {{
                haPodcast
                  ? 'Modifica la scheda del podcast'
                  : 'Dichiara un podcast su questa chiave'
              }}
            </summary>

            <form class="mt-4 flex flex-col gap-4" @submit.prevent="componiPodcast">
              <BaseAlert tono="avviso">
                Per NIP-F4
                <strong>il podcast è la chiave stessa</strong>
                : questa scheda dice che
                <em>questa identità</em>
                è un podcast. Se preferisci tenerlo separato dalla tua identità personale, crea una
                chiave dedicata e usa quella.
              </BaseAlert>

              <BaseField v-slot="{ id, describedBy }" label="Titolo del podcast" required>
                <BaseInput :id="id" v-model="podcastTitolo" :described-by="describedBy" />
              </BaseField>

              <BaseField v-slot="{ id, describedBy }" label="Descrizione">
                <BaseTextarea
                  :id="id"
                  v-model="podcastDescrizione"
                  :rows="3"
                  :described-by="describedBy"
                />
              </BaseField>

              <BaseField
                v-slot="{ id, describedBy }"
                label="Copertina"
                hint="URL. Puoi caricarla dalla sezione media."
              >
                <BaseInput
                  :id="id"
                  v-model="podcastImmagine"
                  placeholder="https://…"
                  :described-by="describedBy"
                />
              </BaseField>

              <BaseField v-slot="{ id, describedBy }" label="Sito">
                <BaseInput :id="id" v-model="podcastSito" :described-by="describedBy" />
              </BaseField>

              <div class="flex flex-wrap gap-2">
                <BaseButton type="submit" variant="primario" :disabled="!podcastTitolo.trim()">
                  Componi evento
                </BaseButton>
                <BaseButton
                  v-if="bozzaPodcast.template.value"
                  variant="primario"
                  :loading="bozzaPodcast.inCorso.value || bozzaPodcast.invio.inCorso.value"
                  :disabled="!identita.puoFirmare"
                  @click="bozzaPodcast.firmaEPubblica()"
                >
                  {{ bozzaPodcast.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
                </BaseButton>
              </div>

              <PublishProgress :invio="bozzaPodcast.invio" />

              <BaseAlert v-if="bozzaPodcast.errore.value" tono="pericolo">
                {{ bozzaPodcast.errore.value }}
              </BaseAlert>

              <PublishResult
                v-if="bozzaPodcast.invio.esito.value"
                :esito="bozzaPodcast.invio.esito.value"
              />
            </form>
          </details>
        </BaseCard>

        <BaseCard v-if="bozza.template.value" title="Evento">
          <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
        </BaseCard>
      </template>
    </ClientOnly>
  </div>
</template>
