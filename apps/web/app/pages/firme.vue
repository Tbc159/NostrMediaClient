<script setup lang="ts">
import { useBanco, kindDelegabili } from '~/stores/banco'
import { useDeleghe } from '~/stores/deleghe'

useHead({ title: 'Firme · NostrMediaClient' })

const identita = useIdentity()
const banco = useBanco()
const deleghe = useDeleghe()
const config = useClientConfigSafe()

onMounted(() => {
  deleghe.carica()
  banco.prepara(config.value.valore?.writeRelays[0] ?? '')
})

// Il banco vive nella scheda: uscendo dalla pagina si spegne, e chi sta
// aspettando una firma riceve un rifiuto invece di restare appeso.
onBeforeUnmount(() => banco.ferma())

const copiato = ref(false)
async function copiaIndirizzo(): Promise<void> {
  if (!banco.uri) return
  try {
    await navigator.clipboard.writeText(banco.uri)
    copiato.value = true
    setTimeout(() => (copiato.value = false), 2000)
  } catch {
    // Appunti negati dal browser: l'indirizzo resta selezionabile a mano.
  }
}

// ─── Nuova delega ─────────────────────────────────────────────────────────
const npubAtteso = ref('')
const indirizzo = ref('')
const etichetta = ref('')

async function aggiungiDelega(): Promise<void> {
  if (await deleghe.aggiungi(npubAtteso.value, indirizzo.value, etichetta.value)) {
    npubAtteso.value = ''
    indirizzo.value = ''
    etichetta.value = ''
  }
}

const titoloDi = (template: { tags: string[][] }): string | undefined =>
  template.tags.find((t) => t[0] === 'title')?.[1]

const ora = (t: number): string => new Date(t).toLocaleTimeString('it-IT')
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-2">
      <h1 class="text-xl font-semibold tracking-tight">Firme</h1>
      <p class="text-sm text-[var(--testo-tenue)]">
        Un evento Nostr ha una sola firma e nessun campo “autore” separato: se vuoi che un episodio
        risulti pubblicato dal podcast, dev’essere la chiave del podcast a firmarlo. NIP-46 permette
        di chiedere quella firma a distanza,
        <strong>senza che la chiave lasci il dispositivo di chi la possiede</strong>
        .
      </p>
    </header>

    <ClientOnly>
      <!-- ─────────── Lato di chi possiede la chiave ─────────── -->
      <BaseCard
        title="Firmo io per altri"
        subtitle="Tieni aperto un banco di firma: gli altri chiedono, tu approvi."
      >
        <div class="flex flex-col gap-4">
          <BaseAlert v-if="!identita.puoFirmare" tono="avviso">
            {{ identita.motivoNonFirmabile ?? 'Serve una chiave che possa firmare.' }}
          </BaseAlert>

          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <BaseBadge :tono="banco.attivo ? 'successo' : 'neutro'">
                {{ banco.attivo ? 'banco aperto' : 'banco chiuso' }}
              </BaseBadge>
              <BaseBadge v-if="banco.cliente" tono="successo">un richiedente collegato</BaseBadge>
              <code class="text-xs text-[var(--testo-tenue)]">
                firma come {{ identita.npub?.slice(0, 16) }}…
              </code>
            </div>

            <BaseField
              label="Relay d’incontro"
              hint="Il banco vi ascolta e chi chiede vi scrive. Deve essere raggiungibile da entrambi."
            >
              <template #default="{ id }">
                <BaseInput
                  :id="id"
                  v-model="banco.relay"
                  :disabled="banco.attivo"
                  placeholder="wss://…"
                />
              </template>
            </BaseField>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-sm font-medium">Cosa accetti di firmare</legend>
              <p class="text-xs text-[var(--testo-tenue)]">
                I kind fuori da questo elenco vengono respinti senza nemmeno chiedertelo.
              </p>
              <label
                v-for="k in kindDelegabili"
                :key="k.kind"
                class="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  class="mt-1"
                  :checked="banco.kindsConsentiti.includes(k.kind)"
                  :disabled="banco.attivo"
                  @change="banco.consentiKind(k.kind, ($event.target as HTMLInputElement).checked)"
                />
                <span>
                  {{ k.etichetta }}
                  <span class="text-[var(--testo-tenue)]">(kind {{ k.kind }})</span>
                  <span class="block text-xs text-[var(--testo-tenue)]">{{ k.nota }}</span>
                </span>
              </label>
            </fieldset>

            <BaseAlert v-if="banco.errore" tono="pericolo">{{ banco.errore }}</BaseAlert>

            <div class="flex flex-wrap gap-2">
              <BaseButton
                v-if="!banco.attivo"
                variant="primario"
                :loading="banco.inAvvio"
                @click="banco.avvia()"
              >
                Apri il banco
              </BaseButton>
              <BaseButton v-else variant="pericolo" @click="banco.ferma()">
                Chiudi il banco
              </BaseButton>
              <BaseButton variant="fantasma" @click="banco.rigeneraIndirizzo()">
                Cambia indirizzo
              </BaseButton>
            </div>

            <template v-if="banco.attivo && banco.uri">
              <BaseField
                label="Indirizzo da consegnare"
                hint="Contiene un segreto: chi lo possiede può chiederti una firma. Passalo per un canale privato, non in chiaro su un relay."
              >
                <template #default="{ id }">
                  <textarea
                    :id="id"
                    readonly
                    rows="3"
                    :value="banco.uri"
                    class="superficie w-full break-all rounded-md border px-3 py-2 font-mono text-xs"
                  />
                </template>
              </BaseField>
              <div>
                <BaseButton size="sm" @click="copiaIndirizzo">
                  {{ copiato ? 'copiato' : 'Copia l’indirizzo' }}
                </BaseButton>
              </div>

              <BaseAlert tono="info">
                Il banco vive in questa scheda: chiudendola si spegne. Serve
                <strong>un richiedente per volta</strong>
                — per un secondo collaboratore cambia indirizzo e consegnagli quello nuovo, così
                revochi il primo senza toccare la chiave.
              </BaseAlert>
            </template>

            <!-- Richieste in attesa di giudizio -->
            <div v-if="banco.richieste.length" class="flex flex-col gap-3">
              <h3 class="text-sm font-semibold">Da approvare ({{ banco.richieste.length }})</h3>
              <div
                v-for="r in banco.richieste"
                :key="r.id"
                class="flex flex-col gap-2 rounded-lg border border-[var(--avviso)] p-3"
              >
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <BaseBadge tono="avviso">kind {{ r.kind }}</BaseBadge>
                  <span>{{ etichettaKind(r.kind) }}</span>
                  <span class="text-[var(--testo-tenue)]">{{ ora(r.quando) }}</span>
                </div>
                <p v-if="titoloDi(r.template)" class="text-sm font-medium">
                  {{ titoloDi(r.template) }}
                </p>
                <p class="text-sm text-[var(--testo-tenue)]">
                  Firmandolo, questo evento risulterà pubblicato da te.
                </p>
                <details class="text-xs">
                  <summary class="cursor-pointer text-[var(--testo-tenue)]">
                    Guarda cosa firmeresti
                  </summary>
                  <pre class="superficie mt-2 overflow-x-auto rounded-md border p-2">{{
                    JSON.stringify(r.template, null, 2)
                  }}</pre>
                </details>
                <div class="flex gap-2">
                  <BaseButton size="sm" variant="primario" @click="banco.decidi(r.id, true)">
                    Firma
                  </BaseButton>
                  <BaseButton size="sm" variant="pericolo" @click="banco.decidi(r.id, false)">
                    Rifiuta
                  </BaseButton>
                </div>
              </div>
            </div>

            <ul v-if="banco.storico.length" class="flex flex-col gap-1 text-xs">
              <li v-for="(v, i) in banco.storico" :key="i" class="text-[var(--testo-tenue)]">
                {{ ora(v.quando) }} · kind {{ v.kind }} ·
                {{ v.approvata ? 'firmato' : 'rifiutato' }}
              </li>
            </ul>
          </template>
        </div>
      </BaseCard>

      <!-- ─────────── Lato di chi chiede ─────────── -->
      <BaseCard
        title="Chiedo la firma a un’altra identità"
        subtitle="Comporrai l’evento tu; a firmarlo, e quindi a risultarne l’autore, sarà l’altra chiave."
      >
        <div class="flex flex-col gap-4">
          <ul v-if="deleghe.elenco.length" class="flex flex-col gap-2">
            <li
              v-for="d in deleghe.elenco"
              :key="d.pubkey"
              class="superficie flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <strong>{{ d.etichetta }}</strong>
              <code class="text-xs text-[var(--testo-tenue)]">
                {{ deleghe.npubDi(d.pubkey).slice(0, 20) }}…
              </code>
              <BaseBadge v-if="deleghe.collegate.includes(d.pubkey)" tono="successo">
                collegata
              </BaseBadge>
              <BaseButton
                size="sm"
                variant="fantasma"
                class="ml-auto"
                @click="deleghe.rimuovi(d.pubkey)"
              >
                Dimentica
              </BaseButton>
            </li>
          </ul>
          <p v-else class="text-sm text-[var(--testo-tenue)]">Nessuna delega registrata.</p>

          <BaseAlert tono="info">
            Un npub da solo non basta: non dice su quale relay ascolti il banco né autorizza a
            parlargli. Serve l’indirizzo
            <code>bunker://</code>
            che ti consegna chi possiede la chiave. L’npub serve subito dopo, come verifica: se il
            banco dichiara un’identità diversa, la delega non viene salvata.
          </BaseAlert>

          <form class="flex flex-col gap-3" @submit.prevent="aggiungiDelega">
            <BaseField
              label="Chi deve risultare l’autore"
              hint="L’npub che ti aspetti. Viene confrontato con quello che il banco dichiara davvero."
            >
              <template #default="{ id }">
                <BaseInput :id="id" v-model="npubAtteso" placeholder="npub1…" />
              </template>
            </BaseField>

            <BaseField
              label="Indirizzo del banco"
              hint="Ricevuto da chi possiede la chiave. Contiene un segreto: non pubblicarlo."
            >
              <template #default="{ id }">
                <BaseInput :id="id" v-model="indirizzo" placeholder="bunker://…" />
              </template>
            </BaseField>

            <BaseField label="Nome" hint="Solo per riconoscerla in un elenco.">
              <template #default="{ id }">
                <BaseInput :id="id" v-model="etichetta" placeholder="Il podcast di Pippo" />
              </template>
            </BaseField>

            <BaseAlert v-if="deleghe.errore" tono="pericolo">{{ deleghe.errore }}</BaseAlert>

            <div>
              <BaseButton type="submit" variant="primario" :loading="deleghe.inCorso">
                Collega e verifica
              </BaseButton>
            </div>
          </form>

          <BaseAlert tono="avviso">
            Un evento firmato per delega esce con la
            <code>pubkey</code>
            dell’altra identità: non comparirà fra i tuoi eventi, perché per Nostr non è tuo. Il tuo
            contributo non è registrato da nessuna parte.
          </BaseAlert>
        </div>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
