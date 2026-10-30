<script setup lang="ts">
import type { VoceRelay } from '@nmc/nostr-core'

import { useSincronizzazione, type QualeLista } from '~/stores/sincronizzazione'

/**
 * The key's public lists next to this device's endpoints: what was published,
 * whether it matches what is here, and the two ways of bringing them in step.
 *
 * Publishing takes two steps on purpose. The 10002 is read by every client the
 * user has, so the page first shows exactly what would go out — and what stays
 * here because nobody else could reach it — and only then signs.
 */

const sinc = useSincronizzazione()
const identita = useIdentity()

const liste: QualeLista[] = ['relay', 'blossom']
const titoli: Record<QualeLista, string> = {
  relay: 'Relay — kind 10002 (NIP-65)',
  blossom: 'Server Blossom — kind 10063 (BUD-03)',
}

const daConfermare = ref<QualeLista | null>(null)

const uso = (v: VoceRelay): string =>
  v.lettura && v.scrittura ? 'lettura e scrittura' : v.lettura ? 'solo lettura' : 'solo scrittura'

const daPubblicare = computed(() => sinc.locali?.liste ?? { relay: [], blossom: [] })

/** What stays on this device, for one list: relays are ws(s)://, servers http(s)://. */
function restaQui(quale: QualeLista): string[] {
  const schema = quale === 'relay' ? /^wss?:/i : /^https?:/i
  return (sinc.locali?.esclusi ?? []).filter((u) => schema.test(u))
}

const vuota = (quale: QualeLista): boolean =>
  quale === 'relay'
    ? daPubblicare.value.relay.length === 0
    : daPubblicare.value.blossom.length === 0

async function conferma(quale: QualeLista): Promise<void> {
  if (await sinc.pubblica(quale)) daConfermare.value = null
}

function prendi(quale: QualeLista): void {
  daConfermare.value = null
  sinc.prendi(quale)
}
</script>

<template>
  <BaseCard
    title="Relay e server Blossom sul tuo account"
    subtitle="Le liste pubbliche della tua chiave. Le legge ogni client Nostr, e NMC le riprende in ogni browser in cui entri con questa chiave."
  >
    <div class="flex flex-col gap-6 text-sm">
      <section v-for="q in liste" :key="q" class="flex flex-col gap-2">
        <p class="font-medium">{{ titoli[q] }}</p>

        <p
          v-if="sinc.stato[q] === 'in-lettura' || sinc.stato[q] === 'da-leggere'"
          class="text-[var(--testo-tenue)]"
        >
          Cerco la lista pubblicata dalla tua chiave…
        </p>
        <p v-else-if="sinc.stato[q] === 'assente'">
          <template v-if="q === 'relay'">
            La tua chiave non ha ancora una lista di relay. Finché manca, gli altri client e il
            servizio del feed non sanno dove cercare i tuoi eventi.
          </template>
          <template v-else>
            La tua chiave non ha ancora una lista di server Blossom: gli altri client non sanno dove
            caricare i tuoi file, né dove ritrovarli.
          </template>
        </p>
        <p v-else-if="sinc.stato[q] === 'allineata'" class="flex flex-wrap items-center gap-2">
          <BaseBadge tono="successo">allineata</BaseBadge>
          <span>Uguale a quella che hai pubblicato il {{ sinc.firmataIl[q] }}.</span>
        </p>
        <template v-else>
          <p class="flex flex-wrap items-center gap-2">
            <BaseBadge tono="avviso">diversa</BaseBadge>
            <span>
              Qui usi {{ q === 'relay' ? 'relay diversi' : 'server diversi' }} da quelli della lista
              che hai pubblicato il {{ sinc.firmataIl[q] }}, che sono:
            </span>
          </p>
          <ul class="ml-4 list-disc font-mono text-xs">
            <template v-if="q === 'relay'">
              <li v-for="v in sinc.pubblicate.relay ?? []" :key="v.url">
                {{ v.url }} — {{ uso(v) }}
              </li>
            </template>
            <template v-else>
              <li v-for="u in sinc.pubblicate.blossom ?? []" :key="u">{{ u }}</li>
            </template>
          </ul>
        </template>

        <BaseAlert v-if="sinc.notizia[q]" tono="successo">{{ sinc.notizia[q] }}</BaseAlert>
        <BaseAlert v-if="sinc.errore[q]" tono="pericolo">{{ sinc.errore[q] }}</BaseAlert>

        <div
          v-if="(sinc.stato[q] === 'assente' || sinc.stato[q] === 'diversa') && daConfermare !== q"
          class="flex flex-wrap gap-2"
        >
          <BaseButton size="sm" @click="daConfermare = q">
            {{ q === 'relay' ? 'Pubblica i relay di qui…' : 'Pubblica i server di qui…' }}
          </BaseButton>
          <BaseButton
            v-if="sinc.stato[q] === 'diversa'"
            size="sm"
            variant="fantasma"
            @click="prendi(q)"
          >
            Usa quelli pubblicati
          </BaseButton>
        </div>

        <div v-if="daConfermare === q" class="superficie flex flex-col gap-3 rounded-md border p-3">
          <template v-if="!vuota(q)">
            <p>Verrà pubblicato, firmato dalla tua chiave:</p>
            <ul class="ml-4 list-disc font-mono text-xs">
              <template v-if="q === 'relay'">
                <li v-for="v in daPubblicare.relay" :key="v.url">{{ v.url }} — {{ uso(v) }}</li>
              </template>
              <template v-else>
                <li v-for="(u, i) in daPubblicare.blossom" :key="u">
                  {{ u }}{{ i === 0 ? ' — primario' : ' — replica' }}
                </li>
              </template>
            </ul>
          </template>
          <p v-if="restaQui(q).length" class="text-[var(--testo-tenue)]">
            Restano solo in questo browser, perché da fuori non sono raggiungibili:
            <span class="font-mono text-xs">{{ restaQui(q).join(', ') }}</span>
          </p>
          <BaseAlert tono="avviso">
            <template v-if="q === 'relay'">
              Questa lista la usano tutti i tuoi client Nostr, non solo NMC: pubblicandola cambi
              dove leggono e scrivono per te.
            </template>
            <template v-else>
              Questa lista la usano gli altri client per caricare i tuoi file e per ritrovarli se un
              server sparisce.
            </template>
          </BaseAlert>
          <BaseAlert v-if="vuota(q)" tono="pericolo">
            Non c’è niente da pubblicare: nessun indirizzo di qui è raggiungibile da fuori.
          </BaseAlert>
          <BaseAlert v-else-if="!identita.puoFirmare" tono="avviso">
            {{ identita.motivoNonFirmabile }}
          </BaseAlert>
          <div class="flex flex-wrap gap-2">
            <BaseButton
              variant="primario"
              size="sm"
              :loading="sinc.inPubblicazione === q"
              :disabled="vuota(q) || !identita.puoFirmare"
              @click="conferma(q)"
            >
              Conferma e pubblica
            </BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="daConfermare = null">
              Annulla
            </BaseButton>
          </div>
        </div>
      </section>

      <PublishResult v-if="sinc.esitoPubblicazione" :esito="sinc.esitoPubblicazione" />

      <BaseButton
        size="sm"
        variant="fantasma"
        class="w-fit"
        :loading="sinc.stato.relay === 'in-lettura'"
        @click="sinc.leggi()"
      >
        Rileggi dai relay
      </BaseButton>
    </div>
  </BaseCard>
</template>
