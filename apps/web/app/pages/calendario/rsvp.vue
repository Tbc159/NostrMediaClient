<script setup lang="ts">
import { getKindDefinition, newCalendarIdentifier } from '@nmc/nostr-core'

const identita = useIdentity()
const bozza = useEventDraft()
const esistente = useEventoEsistente()
const rotta = useRoute()

/** Vero quando si sta cambiando una risposta gia' data. */
const modifica = ref(false)

useHead({
  title: () => (modifica.value ? 'Cambia risposta' : 'Rispondi all’invito') + ' · NostrMediaClient',
})

const identificatore = ref(newCalendarIdentifier())
/** Coordinata dell'evento a cui si risponde: `<kind>:<pubkey>:<d>`. */
const coordinata = ref('')
const stato = ref<'accepted' | 'declined' | 'tentative'>('accepted')
const disponibilita = ref<'busy' | 'free'>('busy')
const nota = ref('')

const risposte = [
  { id: 'accepted' as const, testo: 'Parteciperò' },
  { id: 'tentative' as const, testo: 'Forse' },
  { id: 'declined' as const, testo: 'Non parteciperò' },
]

const coordinataValida = computed(() => /^\d+:[0-9a-f]{64}:.*$/i.test(coordinata.value.trim()))

onMounted(async () => {
  const d = rotta.query.d
  const a = rotta.query.a
  // Arrivando da un evento di calendario si riceve la coordinata a cui rispondere.
  if (typeof a === 'string' && a) coordinata.value = a
  if (typeof d === 'string' && d) await riapri(d)
})

async function riapri(d: string): Promise<void> {
  const trovato = await esistente.perCoordinata(31925, d)
  if (!trovato) return

  const definizione = getKindDefinition(31925)
  if (!definizione) return

  try {
    const dati = definizione.parse(trovato)
    modifica.value = true
    // L'identificatore resta quello: e' cio' che rende questa una sostituzione
    // della risposta precedente invece di una seconda risposta allo stesso
    // evento, che lascerebbe l'organizzatore con due RSVP contraddittori.
    identificatore.value = dati.identifier
    coordinata.value = dati.eventAddress
    stato.value = dati.status
    disponibilita.value = dati.freebusy ?? 'busy'
    nota.value = dati.note
  } catch (e) {
    esistente.errore.value = `La risposta pubblicata non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

function componi(): void {
  const definizione = getKindDefinition(31925)
  if (!definizione) {
    bozza.errore.value = 'Kind 31925 non registrato.'
    return
  }

  bozza.costruisci(definizione, {
    identifier: identificatore.value,
    eventAddress: coordinata.value.trim(),
    status: stato.value,
    // La disponibilita' su un rifiuto non ha senso e la definizione la scarta:
    // non la si manda nemmeno.
    ...(stato.value === 'declined' ? {} : { freebusy: disponibilita.value }),
    ...(nota.value.trim() ? { note: nota.value.trim() } : {}),
    // L'organizzatore va avvisato: e' la pubkey dentro la coordinata.
    ...(coordinataValida.value ? { organizer: coordinata.value.split(':')[1] } : {}),
  })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">
          {{ modifica ? 'Cambia la tua risposta' : 'Rispondi all’invito' }}
        </h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 31925 — RSVP (NIP-52).</p>
      </div>
      <BaseButton to="/calendario" variant="fantasma">← Torna al calendario</BaseButton>
    </div>

    <ClientOnly>
      <div
        v-if="esistente.caricamento.value"
        class="superficie h-16 animate-pulse rounded-xl border"
      />
      <BaseAlert v-if="esistente.errore.value" tono="pericolo">
        {{ esistente.errore.value }}
      </BaseAlert>

      <BaseAlert v-if="modifica" tono="info">
        Ripubblicando con lo stesso identificatore la risposta precedente viene sostituita, invece
        di affiancarsi: l’organizzatore non si ritrova con due risposte contraddittorie.
      </BaseAlert>

      <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
        {{ identita.motivoNonFirmabile }}
        <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
        .
      </BaseAlert>
    </ClientOnly>

    <BaseCard>
      <form class="flex flex-col gap-4" @submit.prevent="componi">
        <BaseField
          v-slot="{ id, describedBy }"
          label="Evento"
          required
          hint="Coordinata nella forma kind:pubkey:identificatore. Arriva da sé partendo da un evento del calendario."
        >
          <BaseInput
            :id="id"
            v-model="coordinata"
            placeholder="31923:…:riunione"
            :described-by="describedBy"
          />
        </BaseField>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">La tua risposta</legend>
          <label
            v-for="r in risposte"
            :key="r.id"
            class="superficie flex cursor-pointer items-center gap-3 rounded-lg border p-3"
            :class="stato === r.id ? 'border-[var(--accento)]' : ''"
          >
            <input v-model="stato" type="radio" :value="r.id" />
            <span class="text-sm">{{ r.testo }}</span>
          </label>
        </fieldset>

        <fieldset v-if="stato !== 'declined'" class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">Disponibilità in quel momento</legend>
          <div class="flex gap-4 text-sm">
            <label class="flex items-center gap-2">
              <input v-model="disponibilita" type="radio" value="busy" />
              occupato
            </label>
            <label class="flex items-center gap-2">
              <input v-model="disponibilita" type="radio" value="free" />
              libero
            </label>
          </div>
        </fieldset>

        <BaseField v-slot="{ id, describedBy }" label="Nota">
          <BaseTextarea :id="id" v-model="nota" :rows="2" :described-by="describedBy" />
        </BaseField>

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario" :disabled="!coordinataValida">
            Componi evento
          </BaseButton>
          <ClientOnly>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firmaEPubblica()"
            >
              {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
            </BaseButton>
          </ClientOnly>
        </div>

        <PublishProgress :invio="bozza.invio" />

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
      <PublishResult :esito="bozza.invio.esito.value" />
    </BaseCard>

    <BaseCard v-if="bozza.template.value" title="Evento">
      <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
    </BaseCard>

    <BaseAlert tono="info">
      La risposta punta alla
      <strong>coordinata</strong>
      dell’evento e non al suo id: gli eventi di calendario sono modificabili, e legare la risposta
      all’id la aggancerebbe a una versione che l’organizzatore può sostituire.
    </BaseAlert>
  </div>
</template>
