<script setup lang="ts">
import { passwordStrength } from '@nmc/nostr-core'
import { campiEndpoint, useConfigurazione, type CampoEndpoint } from '~/stores/configurazione'
import { linkEventoEsterno, type PiattaformaClient } from '@nmc/nostr-core'

useHead({ title: 'Impostazioni · NostrMediaClient' })

const identita = useIdentity()
const configSafe = useClientConfigSafe()
const config = computed(() => configSafe.value)

const configurazione = useConfigurazione()

// Questa e' la pagina da cui si accede con l'estensione: vale la pena
// ricontrollare che ci sia ogni volta che la si apre, invece di fidarsi del
// rilevamento fatto all'avvio dell'applicazione.
onMounted(() => identita.rilevaEstensione())

/**
 * Copia modificabile degli endpoint.
 *
 * Si edita una bozza e non lo store direttamente: cambiando i relay carattere
 * per carattere si passa per stati intermedi non validi (`wss://u`), e
 * applicarli man mano significherebbe far pubblicare il client su indirizzi
 * scritti a meta'.
 */
const bozzaEndpoint = reactive(
  Object.fromEntries(
    campiEndpoint.map((c) => [c.chiave, configurazione.valoreDi(c.chiave)]),
  ) as Record<CampoEndpoint['chiave'], string>,
)

const erroreEndpoint = ref<string | null>(null)
const salvato = ref(false)

const strategie = [
  {
    id: 'sequenziale' as const,
    titolo: 'A rotazione, uno per volta (consigliata)',
    spiegazione:
      'Prova i relay nell’ordine in cui li hai scritti e si ferma al primo che prende in carico l’evento. Apre una connessione per volta, quindi non incappa nei limiti per indirizzo IP dei relay. In cambio l’evento finisce su un solo relay.',
  },
  {
    id: 'tutti' as const,
    titolo: 'Tutti insieme',
    spiegazione:
      'Invia a tutti i relay in parallelo. L’evento risulta più raggiungibile, ma aprire molte connessioni insieme è anche il modo più facile per vederne fallire qualcuna.',
  },
]

function salvaEndpoint(): void {
  salvato.value = false
  const esito = configurazione.applica({ ...bozzaEndpoint })
  if (esito.ok) {
    erroreEndpoint.value = null
    salvato.value = true
  } else {
    erroreEndpoint.value = esito.errore
  }
}

// --- Client di lettura esterni ---------------------------------------------

const { piattaforma } = useDispositivo()

const piattaforme: { id: PiattaformaClient; etichetta: string; nota: string }[] = [
  {
    id: 'desktop',
    etichetta: 'Da scrivania',
    nota: 'Usato quando c’è un puntatore fine: si apre una scheda del browser.',
  },
  {
    id: 'app',
    etichetta: 'Da telefono',
    nota: 'Usato su schermi touch senza passaggio del mouse: qui ha senso l’app installata.',
  },
]

/** Evento finto, solo per mostrare che forma prende il link. */
const eventoDiEsempio = {
  id: 'ff'.repeat(32),
  pubkey: 'ab'.repeat(32),
  created_at: 1_800_000_000,
  kind: 1,
  tags: [],
  content: '',
  sig: '00'.repeat(64),
}

function anteprimaLink(piattaformaScelta: PiattaformaClient): string {
  try {
    return linkEventoEsterno(
      configurazione.visualizzatorePer(piattaformaScelta).template,
      eventoDiEsempio,
      config.value.valore?.writeRelays ?? [],
    )
  } catch {
    return 'modello non valido'
  }
}

const nuovoNome = ref('')
const nuovoTemplate = ref('')
const erroreVisualizzatore = ref<string | null>(null)

function aggiungiVisualizzatore(): void {
  const esito = configurazione.aggiungiVisualizzatore(nuovoNome.value, nuovoTemplate.value)
  if (esito.ok) {
    erroreVisualizzatore.value = null
    nuovoNome.value = ''
    nuovoTemplate.value = ''
  } else {
    erroreVisualizzatore.value = esito.errore
  }
}

function tornaAiDefault(): void {
  configurazione.ripristinaDefault()
  for (const c of campiEndpoint) bozzaEndpoint[c.chiave] = configurazione.valoreDi(c.chiave)
  erroreEndpoint.value = null
  salvato.value = true
}

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
    <ClientOnly>
      <BaseCard
        title="Endpoint"
        subtitle="I valori del file .env sono soltanto il punto di partenza: qui li sostituisci, e la scelta resta in questo browser."
      >
        <BaseAlert v-if="config.errore" tono="pericolo" class="mb-4">
          La configurazione attuale non è valida e il client non può leggere né pubblicare finché
          resta così: {{ config.errore }}
        </BaseAlert>

        <form class="flex flex-col gap-5" @submit.prevent="salvaEndpoint">
          <BaseField
            v-for="campo in campiEndpoint"
            :key="campo.chiave"
            v-slot="{ id, describedBy }"
            :label="campo.etichetta"
            :hint="campo.descrizione"
          >
            <div class="flex flex-col gap-1">
              <BaseTextarea
                v-if="campo.multiplo"
                :id="id"
                v-model="bozzaEndpoint[campo.chiave]"
                :rows="2"
                :placeholder="
                  campo.schema === 'wss'
                    ? 'wss://uno.example, wss://due.example'
                    : 'https://uno.example'
                "
                :described-by="describedBy"
              />
              <BaseInput
                v-else
                :id="id"
                v-model="bozzaEndpoint[campo.chiave]"
                :placeholder="campo.schema === 'wss' ? 'wss://privato.example' : 'https://…'"
                :described-by="describedBy"
              />
              <p class="text-xs text-[var(--testo-tenue)]">
                <BaseBadge v-if="configurazione.sovrascritto(campo.chiave)" tono="accento">
                  sostituito da te
                </BaseBadge>
                <BaseBadge v-else>dal file .env</BaseBadge>
              </p>
            </div>
          </BaseField>

          <BaseAlert v-if="erroreEndpoint" tono="pericolo">{{ erroreEndpoint }}</BaseAlert>
          <BaseAlert v-else-if="salvato" tono="successo">
            Endpoint aggiornati. Valgono da subito, senza riavviare il client.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton type="submit" variant="primario">Salva gli endpoint</BaseButton>
            <BaseButton
              v-if="configurazione.personalizzata"
              variant="fantasma"
              @click="tornaAiDefault"
            >
              Torna ai valori del .env
            </BaseButton>
            <BaseButton to="/diagnostica" variant="fantasma">Verifica gli endpoint →</BaseButton>
          </div>
        </form>
      </BaseCard>

      <!-- ─────────── Client di lettura esterni ─────────── -->
      <BaseCard
        title="Con cosa aprire le tue pubblicazioni"
        subtitle="Questo client serve a gestire i tuoi contenuti. Per vederli come li vede il resto della rete serve un client di lettura."
      >
        <div class="flex flex-col gap-5">
          <p class="text-sm text-[var(--testo-tenue)]">
            Ogni evento in elenco porta un pulsante «Apri in…». Quale client si apre dipende da come
            stai usando il client adesso: in questo momento risulti
            <BaseBadge tono="accento">
              {{ piattaforma === 'app' ? 'da telefono' : 'da scrivania' }}
            </BaseBadge>
            .
          </p>

          <div v-for="p in piattaforme" :key="p.id" class="flex flex-col gap-2">
            <BaseField
              v-slot="{ id, describedBy }"
              :label="p.etichetta"
              :hint="p.nota"
              :class="piattaforma === p.id ? '' : 'opacity-80'"
            >
              <BaseSelect
                :id="id"
                :model-value="configurazione.visualizzatorePer(p.id).id"
                :options="
                  configurazione.visualizzatoriDisponibili
                    .filter((c) => c.piattaforme.includes(p.id) || c.id.startsWith('mio-'))
                    .map((c) => ({ value: c.id, label: c.nome }))
                "
                :described-by="describedBy"
                @update:model-value="configurazione.impostaVisualizzatore(p.id, String($event))"
              />
            </BaseField>
            <p
              v-if="configurazione.visualizzatorePer(p.id).nota"
              class="text-xs text-[var(--testo-tenue)]"
            >
              {{ configurazione.visualizzatorePer(p.id).nota }}
            </p>
            <p class="break-all font-mono text-xs text-[var(--testo-tenue)]">
              {{ anteprimaLink(p.id) }}
            </p>
          </div>

          <details>
            <summary class="cursor-pointer text-sm">Aggiungi un altro client</summary>
            <div class="mt-3 flex flex-col gap-3">
              <BaseField v-slot="{ id, describedBy }" label="Nome">
                <BaseInput :id="id" v-model="nuovoNome" :described-by="describedBy" />
              </BaseField>
              <BaseField
                v-slot="{ id, describedBy }"
                label="Modello dell’indirizzo"
                hint="Metti {pointer} dove va l’identificatore dell’evento. Sono ammessi https:// e nostr:."
              >
                <BaseInput
                  :id="id"
                  v-model="nuovoTemplate"
                  placeholder="https://ilmioclient.tld/e/{pointer}"
                  :described-by="describedBy"
                />
              </BaseField>
              <BaseAlert v-if="erroreVisualizzatore" tono="pericolo">
                {{ erroreVisualizzatore }}
              </BaseAlert>
              <BaseButton class="w-fit" @click="aggiungiVisualizzatore">Aggiungi</BaseButton>

              <ul
                v-if="configurazione.visualizzatoriPersonali.length"
                class="flex flex-col gap-2 text-sm"
              >
                <li
                  v-for="c in configurazione.visualizzatoriPersonali"
                  :key="c.id"
                  class="flex flex-wrap items-center gap-2"
                >
                  <span class="flex-1 truncate">{{ c.nome }}</span>
                  <code class="truncate text-xs text-[var(--testo-tenue)]">{{ c.template }}</code>
                  <BaseButton
                    size="sm"
                    variant="fantasma"
                    @click="configurazione.rimuoviVisualizzatore(c.id)"
                  >
                    Togli
                  </BaseButton>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </BaseCard>

      <!-- ─────────── Strategia di pubblicazione ─────────── -->
      <BaseCard
        title="Come distribuire quello che pubblichi"
        subtitle="Con più relay di scrittura c’è un compromesso, e non ha una risposta unica."
      >
        <div class="flex flex-col gap-3">
          <label
            v-for="s in strategie"
            :key="s.id"
            class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
            :class="configurazione.strategia === s.id ? 'border-[var(--accento)]' : ''"
          >
            <input
              type="radio"
              name="strategia"
              class="mt-1"
              :value="s.id"
              :checked="configurazione.strategia === s.id"
              @change="configurazione.impostaStrategia(s.id)"
            />
            <span class="flex flex-col gap-1">
              <span class="text-sm font-medium">{{ s.titolo }}</span>
              <span class="text-xs text-[var(--testo-tenue)]">{{ s.spiegazione }}</span>
            </span>
          </label>
        </div>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
