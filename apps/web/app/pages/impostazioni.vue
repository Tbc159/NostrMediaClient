<script setup lang="ts">
import { passwordStrength } from '@nmc/nostr-core'

useHead({ title: 'Impostazioni · NostrMediaClient' })

const identita = useIdentity()
const config = useClientConfigSafe()

type Scheda = 'estensione' | 'chiave' | 'lettura'
const scheda = ref<Scheda>('estensione')

// Definite qui e non nel template: le espressioni di un template Vue sono
// JavaScript puro, quindi `as const` non e' utilizzabile li'.
const schede: { id: Scheda; label: string }[] = [
  { id: 'estensione', label: 'Estensione' },
  { id: 'chiave', label: 'Chiave privata' },
  { id: 'lettura', label: 'Sola lettura' },
]

function scegliScheda(id: Scheda): void {
  scheda.value = id
  errore.value = null
}

const chiaveInserita = ref('')
const password = ref('')
const passwordConferma = ref('')
const npubInserito = ref('')
const passwordSblocco = ref('')
const errore = ref<string | null>(null)
const inCorso = ref(false)

const robustezza = computed(() => passwordStrength(password.value))
const coloreRobustezza = ['var(--pericolo)', 'var(--avviso)', 'var(--avviso)', 'var(--successo)']

function pulisci(): void {
  // I campi con materiale sensibile non restano appesi in memoria piu' del
  // necessario, e non ricompaiono se l'utente torna sulla pagina.
  chiaveInserita.value = ''
  password.value = ''
  passwordConferma.value = ''
  passwordSblocco.value = ''
}

async function conEstensione(): Promise<void> {
  errore.value = null
  inCorso.value = true
  try {
    await identita.accediConEstensione()
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  } finally {
    inCorso.value = false
  }
}

function conChiave(): void {
  errore.value = null
  if (password.value !== passwordConferma.value) {
    errore.value = 'Le due password non coincidono.'
    return
  }
  if (password.value.length < 8) {
    errore.value = 'La password deve avere almeno 8 caratteri.'
    return
  }
  try {
    identita.accediConChiave(chiaveInserita.value, password.value)
    pulisci()
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  }
}

function solaLettura(): void {
  errore.value = null
  try {
    identita.accediSolaLettura(npubInserito.value)
    npubInserito.value = ''
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  }
}

function sblocca(): void {
  errore.value = null
  try {
    identita.sblocca(passwordSblocco.value)
    passwordSblocco.value = ''
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  }
}

function esci(): void {
  identita.esci()
  pulisci()
  errore.value = null
}

const etichettaModo: Record<string, string> = {
  nip07: 'Estensione del browser (NIP-07)',
  locale: 'Chiave privata salvata in questo browser',
  readonly: 'Sola lettura',
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold tracking-tight">Impostazioni</h1>

    <ClientOnly>
      <!-- ─────────── Identità già attiva ─────────── -->
      <BaseCard v-if="identita.autenticato" title="Identità">
        <div class="flex flex-col gap-4">
          <dl class="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt class="text-[var(--testo-tenue)]">Modalità</dt>
            <dd>{{ etichettaModo[identita.modo ?? ''] }}</dd>
            <dt class="text-[var(--testo-tenue)]">Chiave pubblica</dt>
            <dd class="break-all font-mono text-xs">{{ identita.npub }}</dd>
          </dl>

          <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
            {{ identita.motivoNonFirmabile }}
          </BaseAlert>
          <BaseAlert v-else tono="successo">
            Puoi pubblicare eventi firmati con questa identità.
          </BaseAlert>

          <!-- Chiave salvata ma bloccata: serve la password per firmare -->
          <form
            v-if="identita.modo === 'locale' && !identita.sbloccato"
            class="flex flex-col gap-3"
            @submit.prevent="sblocca"
          >
            <BaseField v-slot="{ id, describedBy }" label="Password della chiave">
              <BaseInput
                :id="id"
                v-model="passwordSblocco"
                type="password"
                autocomplete="current-password"
                :described-by="describedBy"
              />
            </BaseField>
            <BaseButton type="submit" variant="primario" class="w-fit">Sblocca</BaseButton>
          </form>

          <div class="flex flex-wrap gap-2">
            <BaseButton
              v-if="identita.modo === 'locale' && identita.sbloccato"
              size="sm"
              @click="identita.blocca()"
            >
              Blocca la chiave
            </BaseButton>
            <BaseButton size="sm" variant="pericolo" @click="esci">Esci</BaseButton>
          </div>

          <p v-if="identita.modo === 'locale'" class="text-xs text-[var(--testo-tenue)]">
            «Esci» cancella la chiave cifrata da questo browser. Assicurati di avere una copia della
            tua nsec altrove: senza, l’identità è persa in modo definitivo.
          </p>
        </div>
      </BaseCard>

      <!-- ─────────── Accesso ─────────── -->
      <BaseCard v-else title="Accedi" subtitle="Tre modi, dal più sicuro al meno sicuro.">
        <div class="flex flex-col gap-5">
          <div role="tablist" aria-label="Modalità di accesso" class="flex flex-wrap gap-1">
            <button
              v-for="s in schede"
              :key="s.id"
              role="tab"
              type="button"
              :aria-selected="scheda === s.id"
              class="rounded-md px-3 py-1.5 text-sm transition-colors"
              :class="
                scheda === s.id
                  ? 'bg-[var(--accento)] text-[var(--accento-testo)]'
                  : 'hover:bg-[var(--sfondo-alt)] text-[var(--testo-tenue)]'
              "
              @click="scegliScheda(s.id)"
            >
              {{ s.label }}
            </button>
          </div>

          <!-- Estensione NIP-07 -->
          <div v-if="scheda === 'estensione'" class="flex flex-col gap-3">
            <p class="text-sm text-[var(--testo-tenue)]">
              L’estensione custodisce la chiave e firma per conto tuo: la chiave privata non entra
              mai in questa pagina. È il modo consigliato.
            </p>
            <BaseAlert v-if="!identita.estensioneDisponibile" tono="avviso">
              Nessuna estensione rilevata. Installa Alby o nos2x, poi ricarica la pagina.
            </BaseAlert>
            <BaseButton
              variant="primario"
              class="w-fit"
              :loading="inCorso"
              :disabled="!identita.estensioneDisponibile"
              @click="conEstensione"
            >
              Accedi con l’estensione
            </BaseButton>
          </div>

          <!-- Chiave privata -->
          <form
            v-else-if="scheda === 'chiave'"
            class="flex flex-col gap-4"
            @submit.prevent="conChiave"
          >
            <BaseAlert tono="pericolo">
              <strong>La chiave privata è la tua identità intera.</strong>
              Chi la ottiene la possiede per sempre: non esiste reset, revoca né recupero. Qui viene
              cifrata con la password prima di essere salvata, ma resta comunque la modalità più
              esposta — soprattutto su un computer condiviso. Se puoi, usa l’estensione.
            </BaseAlert>

            <BaseField
              v-slot="{ id, describedBy }"
              label="Chiave privata"
              hint="Formato nsec1… oppure 64 caratteri esadecimali."
              required
            >
              <BaseInput
                :id="id"
                v-model="chiaveInserita"
                type="password"
                autocomplete="off"
                placeholder="nsec1…"
                :described-by="describedBy"
              />
            </BaseField>

            <BaseField
              v-slot="{ id, describedBy }"
              label="Password di protezione"
              hint="Serve a cifrare la chiave in questo browser. Non è recuperabile."
              required
            >
              <BaseInput
                :id="id"
                v-model="password"
                type="password"
                autocomplete="new-password"
                :described-by="describedBy"
              />
            </BaseField>

            <div v-if="password" class="flex items-center gap-2 text-xs">
              <div class="h-1 w-24 overflow-hidden rounded-full bg-[var(--sfondo-alt)]">
                <div
                  class="h-full transition-all"
                  :style="{
                    width: `${((robustezza.score + 1) / 4) * 100}%`,
                    backgroundColor: coloreRobustezza[robustezza.score],
                  }"
                />
              </div>
              <span :style="{ color: coloreRobustezza[robustezza.score] }">
                {{ robustezza.label }}
              </span>
              <span v-if="robustezza.hint" class="text-[var(--testo-tenue)]">
                {{ robustezza.hint }}
              </span>
            </div>

            <BaseField v-slot="{ id, describedBy }" label="Ripeti la password" required>
              <BaseInput
                :id="id"
                v-model="passwordConferma"
                type="password"
                autocomplete="new-password"
                :described-by="describedBy"
              />
            </BaseField>

            <BaseButton type="submit" variant="primario" class="w-fit">
              Accedi con la chiave
            </BaseButton>
          </form>

          <!-- Sola lettura -->
          <form v-else class="flex flex-col gap-4" @submit.prevent="solaLettura">
            <p class="text-sm text-[var(--testo-tenue)]">
              Serve solo la chiave pubblica: puoi leggere tutto ma non pubblicare nulla. Utile per
              dare un’occhiata senza esporre nulla.
            </p>
            <BaseField
              v-slot="{ id, describedBy }"
              label="Chiave pubblica"
              hint="Formato npub1…, nprofile1… oppure esadecimale."
              required
            >
              <BaseInput
                :id="id"
                v-model="npubInserito"
                placeholder="npub1…"
                :described-by="describedBy"
              />
            </BaseField>
            <BaseButton type="submit" variant="primario" class="w-fit">
              Entra in sola lettura
            </BaseButton>
          </form>

          <BaseAlert v-if="errore" tono="pericolo">{{ errore }}</BaseAlert>
        </div>
      </BaseCard>
    </ClientOnly>

    <!-- ─────────── Endpoint ─────────── -->
    <BaseCard title="Endpoint" subtitle="Definiti in .env. Dopo una modifica serve un riavvio.">
      <BaseAlert v-if="config.errore" tono="pericolo">{{ config.errore }}</BaseAlert>
      <dl v-else class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-[var(--testo-tenue)]">Lettura</dt>
        <dd class="break-all font-mono text-xs">{{ config.valore?.readRelays.join(', ') }}</dd>
        <dt class="text-[var(--testo-tenue)]">Scrittura</dt>
        <dd class="break-all font-mono text-xs">{{ config.valore?.writeRelays.join(', ') }}</dd>
        <dt class="text-[var(--testo-tenue)]">Indicizzatori</dt>
        <dd class="break-all font-mono text-xs">{{ config.valore?.indexerRelays.join(', ') }}</dd>
        <dt class="text-[var(--testo-tenue)]">Bozze</dt>
        <dd class="break-all font-mono text-xs">
          {{ config.valore?.draftRelay ?? 'non configurato — salvataggio bozze disattivo' }}
        </dd>
        <dt class="text-[var(--testo-tenue)]">Blossom</dt>
        <dd class="break-all font-mono text-xs">{{ config.valore?.blossomServers.join(', ') }}</dd>
      </dl>
      <div class="mt-4">
        <BaseButton to="/diagnostica" size="sm">Verifica gli endpoint →</BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
