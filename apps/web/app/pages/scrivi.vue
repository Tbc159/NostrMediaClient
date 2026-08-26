<script setup lang="ts">
import { getKindDefinition } from '@nmc/nostr-core'

useHead({ title: 'Scrivi · NostrMediaClient' })

const identita = useIdentity()
const bozza = useEventDraft()

const contenuto = ref('')
const hashtag = ref('')
const rispostaA = ref('')
const citazione = ref('')
const mostraAvanzate = ref(false)

/** Limite convenzionale: nessun NIP lo impone, ma i relay hanno tetti sui messaggi. */
const LIMITE_CONSIGLIATO = 2000
const lunghezza = computed(() => contenuto.value.length)
const oltreLimite = computed(() => lunghezza.value > LIMITE_CONSIGLIATO)

const hashtagList = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean),
)

const puoComporre = computed(() => contenuto.value.trim().length > 0)

function componi(): void {
  const definizione = getKindDefinition(1)
  if (!definizione) {
    bozza.errore.value = 'Kind 1 non registrato: problema di avvio dell’applicazione.'
    return
  }

  bozza.costruisci(definizione, {
    content: contenuto.value.trim(),
    ...(hashtagList.value.length ? { hashtags: hashtagList.value } : {}),
    ...(rispostaA.value.trim()
      ? { replyTo: { id: rispostaA.value.trim(), pubkey: identita.pubkey ?? '' } }
      : {}),
    ...(citazione.value.trim() ? { quoteId: citazione.value.trim() } : {}),
  })
}

function nuovo(): void {
  contenuto.value = ''
  hashtag.value = ''
  rispostaA.value = ''
  citazione.value = ''
  bozza.azzera()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Scrivi una nota</h1>
      <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 1 — nota di testo breve.</p>
    </div>

    <ClientOnly>
      <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
        {{ identita.motivoNonFirmabile }}
        <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
        . Puoi comunque comporre l’evento e vederne il risultato.
      </BaseAlert>
    </ClientOnly>

    <BaseCard>
      <form class="flex flex-col gap-4" @submit.prevent="componi">
        <BaseField v-slot="{ id, describedBy }" label="Contenuto" required>
          <BaseTextarea
            :id="id"
            v-model="contenuto"
            :rows="6"
            placeholder="Che succede?"
            :described-by="describedBy"
          />
        </BaseField>

        <div class="flex items-center justify-between text-xs">
          <span :class="oltreLimite ? 'text-[var(--avviso)]' : 'text-[var(--testo-tenue)]'">
            {{ lunghezza }} caratteri
            <template v-if="oltreLimite">
              — oltre {{ LIMITE_CONSIGLIATO }}: alcuni relay potrebbero rifiutarla
            </template>
          </span>
          <button
            type="button"
            class="text-[var(--testo-tenue)] underline"
            @click="mostraAvanzate = !mostraAvanzate"
          >
            {{ mostraAvanzate ? 'nascondi opzioni' : 'opzioni avanzate' }}
          </button>
        </div>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Hashtag"
          hint="Separati da spazio o virgola. Il cancelletto è opzionale."
        >
          <BaseInput
            :id="id"
            v-model="hashtag"
            placeholder="nostr calendario"
            :described-by="describedBy"
          />
        </BaseField>

        <template v-if="mostraAvanzate">
          <BaseField
            v-slot="{ id, describedBy }"
            label="Rispondi all’evento"
            hint="Id esadecimale della nota a cui rispondere. Il thread viene marcato secondo NIP-10."
          >
            <BaseInput
              :id="id"
              v-model="rispostaA"
              placeholder="id evento"
              :described-by="describedBy"
            />
          </BaseField>

          <BaseField
            v-slot="{ id, describedBy }"
            label="Cita l’evento"
            hint="Id esadecimale dell’evento da citare (tag q)."
          >
            <BaseInput
              :id="id"
              v-model="citazione"
              placeholder="id evento"
              :described-by="describedBy"
            />
          </BaseField>
        </template>

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario" :disabled="!puoComporre">
            Componi evento
          </BaseButton>
          <ClientOnly>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firma()"
            >
              Firma
            </BaseButton>
          </ClientOnly>
          <BaseButton v-if="bozza.template.value" variant="fantasma" @click="nuovo">
            Ricomincia
          </BaseButton>
        </div>

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.template.value" title="Evento">
      <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
    </BaseCard>

    <BaseAlert tono="info">
      Una nota pubblicata
      <strong>non è modificabile</strong>
      : il kind 1 è un evento regolare e il protocollo non prevede la sostituzione. Correggerla
      significa chiederne la cancellazione (kind 5) e ripubblicarla, ottenendo però un id nuovo e
      perdendo risposte e reazioni.
    </BaseAlert>
  </div>
</template>
