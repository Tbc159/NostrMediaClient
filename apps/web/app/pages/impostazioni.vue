<script setup lang="ts">
import { passwordStrength, toNpub } from '@nmc/nostr-core'

import type { IdentitaSalvata } from '~/stores/identity'
import { campiEndpoint, useConfigurazione, type CampoEndpoint } from '~/stores/configurazione'
import { useMediaManager } from '~/stores/mediamanager'
import { linkEventoEsterno, type PiattaformaClient } from '@nmc/nostr-core'

useHead({ title: 'Impostazioni · NostrMediaClient' })

const identita = useIdentity()
const configSafe = useClientConfigSafe()
const config = computed(() => configSafe.value)

const configurazione = useConfigurazione()

// This is the page you log in with the extension from: it is worth checking
// again that it is there every time the page is opened, instead of trusting
// the detection done when the application started.
onMounted(() => identita.rilevaEstensione())

/**
 * An editable copy of the endpoints.
 *
 * A draft is edited and not the store directly: changing the relays character
 * by character goes through invalid intermediate states (`wss://u`), and
 * applying them as they come would have the client publish to half-written
 * addresses.
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
      'Prova i relay nell’ordine in cui li hai scritti e si ferma al primo che prende in carico l’evento. Apre una connessione per volta, quindi non incappa nei limiti per indirizzo IP dei relay. In cambio l’evento finisce su un solo relay. Vale per note e media; profilo, liste, articoli, scheda ed episodi del podcast vanno comunque su tutti, perché chi li cerca legge dal relay suo.',
  },
  {
    id: 'tutti' as const,
    titolo: 'Tutti insieme',
    spiegazione:
      'Invia a tutti i relay in parallelo. L’evento risulta più raggiungibile, ma aprire molte connessioni insieme è anche il modo più facile per vederne fallire qualcuna.',
  },
]

/**
 * The import's safety limit, edited in GB.
 *
 * Applied on change and not on every keystroke, like the endpoints: «0,» on
 * the way to «0,5» is not a limit anyone meant.
 */
const limiteGb = ref(String(+(configurazione.limiteImportByte / 1024 ** 3).toFixed(2)))
const erroreLimite = ref<string | null>(null)

function salvaLimite(): void {
  const gb = Number(limiteGb.value.replace(',', '.'))
  if (!Number.isFinite(gb) || gb <= 0) {
    erroreLimite.value = 'Scrivi un numero di GB maggiore di zero.'
    return
  }
  erroreLimite.value = null
  configurazione.impostaLimiteImport(gb * 1024 ** 3)
}

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

// --- Processing service ------------------------------------------------------

/*
 * The service behind the Audio section.
 *
 * The archive and the audio processing are two domains of the same
 * microservice: one address, one key. And they are here, not in the page:
 * whoever opens «Audio» wants to work on a recording, not answer
 * administration questions. The default comes from the environment and is the
 * working one already.
 */

const mediaManager = useMediaManager()

const bozzaServizi = reactive({
  url: mediaManager.baseUrl,
  chiave: mediaManager.apiKey,
})

// The defaults come from the plugin, which runs before this page but not
// before the `reactive` above in a hot reload: it realigns the draft when the
// effective values change from underneath (a reset included).
watch(
  () => [mediaManager.baseUrl, mediaManager.apiKey] as const,
  ([u, k]) => {
    bozzaServizi.url = u
    bozzaServizi.chiave = k
  },
  { immediate: true },
)

const serviziSalvati = ref(false)

// This is the page you come to in order to find out whether the service
// answers: the domains' pills have to be there when it opens, not only after
// «Save and check» has been pressed.
onMounted(() => {
  if (mediaManager.configurato) void mediaManager.verifica()
})

/** The service's domains, with the name of the section each one feeds. */
const dominiServizio = [
  { chiave: 'media' as const, etichetta: 'media', a_cosa_serve: 'archivio' },
  { chiave: 'audio' as const, etichetta: 'audio', a_cosa_serve: 'elaborazione audio' },
]

async function salvaServizi(): Promise<void> {
  mediaManager.applica({ baseUrl: bozzaServizi.url, apiKey: bozzaServizi.chiave })
  serviziSalvati.value = true
  await mediaManager.verifica()
}

function ripristinaServizi(): void {
  mediaManager.ripristina()
  serviziSalvati.value = false
}

// --- External reading clients ---------------------------------------------

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

/** A fake event, only to show what shape the link takes. */
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
      configurazione.visualizzatorePer(piattaformaScelta),
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

// Defined here and not in the template: the expressions of a Vue template are
// plain JavaScript, so `as const` cannot be used there.
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
  // The fields with sensitive material do not hang about in memory longer
  // than necessary, and do not reappear when the user comes back to the page.
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

/** Logging in to one more identity, keeping the active one among the saved. */
const aggiungendo = ref(false)
watch(
  () => identita.pubkey,
  () => {
    aggiungendo.value = false
  },
)

const erroreSalvate = ref<string | null>(null)
async function usa(pubkey: string): Promise<void> {
  erroreSalvate.value = null
  try {
    await identita.cambiaIdentita(pubkey)
  } catch (e) {
    erroreSalvate.value = e instanceof Error ? e.message : String(e)
  }
}

function dimentica(s: IdentitaSalvata): void {
  const avviso =
    s.modo === 'locale'
      ? 'La chiave cifrata di questa identità viene cancellata da questo browser. Senza una copia della sua nsec è persa per sempre. Procedo?'
      : 'Questa identità sparisce dall’elenco di questo browser. Procedo?'
  if (window.confirm(avviso)) identita.dimentica(s.pubkey)
}

const nomeSalvata = (s: IdentitaSalvata): string =>
  s.etichetta ?? `${toNpub(s.pubkey).slice(0, 16)}…`

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
      <!-- ─────────── An identity already active ─────────── -->
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

          <!-- A saved but locked key: the password is needed to sign -->
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
            <BaseButton v-if="!aggiungendo" size="sm" @click="aggiungendo = true">
              Aggiungi un’altra identità
            </BaseButton>
            <BaseButton size="sm" variant="pericolo" @click="esci">Esci</BaseButton>
          </div>

          <!-- The other identities kept in this browser -->
          <div v-if="identita.salvate.length > 1" class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">Identità salvate in questo browser</h3>
            <ul class="flex flex-col gap-1.5">
              <li
                v-for="s in identita.salvate"
                :key="s.pubkey"
                class="superficie flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span class="min-w-0 flex-1 truncate" :title="toNpub(s.pubkey)">
                  {{ nomeSalvata(s) }}
                </span>
                <span class="text-xs text-[var(--testo-tenue)]">{{ etichettaModo[s.modo] }}</span>
                <BaseBadge v-if="s.pubkey === identita.pubkey" tono="accento">attiva</BaseBadge>
                <BaseButton v-else size="sm" @click="usa(s.pubkey)">Usa</BaseButton>
                <BaseButton
                  v-if="s.pubkey !== identita.pubkey"
                  size="sm"
                  variant="fantasma"
                  @click="dimentica(s)"
                >
                  Dimentica
                </BaseButton>
              </li>
            </ul>
            <BaseAlert v-if="erroreSalvate" tono="pericolo">{{ erroreSalvate }}</BaseAlert>
            <p class="text-xs text-[var(--testo-tenue)]">
              Una sola chiave è aperta alla volta: cambiando identità, quella precedente si
              richiude, e una chiave salvata qui chiede di nuovo la sua password.
            </p>
          </div>

          <p v-if="identita.modo === 'locale'" class="text-xs text-[var(--testo-tenue)]">
            «Esci» cancella la chiave cifrata da questo browser. Assicurati di avere una copia della
            tua nsec altrove: senza, l’identità è persa in modo definitivo.
          </p>
        </div>
      </BaseCard>

      <!-- ─────────── Logging in ─────────── -->
      <BaseCard
        v-if="!identita.autenticato || aggiungendo"
        :title="aggiungendo ? 'Aggiungi un’identità' : 'Accedi'"
        subtitle="Tre modi, dal più sicuro al meno sicuro."
      >
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

          <!-- NIP-07 extension -->
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

          <!-- Private key -->
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

          <!-- Read-only -->
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

    <!-- ─────────── Endpoints ─────────── -->
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

      <!-- ─────────── Processing service ─────────── -->
      <BaseCard
        title="Servizio di elaborazione"
        subtitle="Il microservizio dietro la sezione Audio. Non è Nostr: è un’API HTTP esterna, e come i relay si può sostituire."
      >
        <form class="flex flex-col gap-5" @submit.prevent="salvaServizi">
          <BaseField
            v-slot="{ id, describedBy }"
            label="Indirizzo"
            hint="Senza /v0, che lo aggiunge il client."
          >
            <div class="flex flex-col gap-1">
              <BaseInput
                :id="id"
                v-model="bozzaServizi.url"
                placeholder="http://…"
                :described-by="describedBy"
              />
              <p class="flex flex-wrap items-center gap-2 text-xs text-[var(--testo-tenue)]">
                <BaseBadge v-if="mediaManager.personalizzato" tono="accento">
                  sostituito da te
                </BaseBadge>
                <BaseBadge v-else>dal file .env</BaseBadge>
                <template v-if="mediaManager.salute">
                  <BaseBadge
                    v-for="d in dominiServizio"
                    :key="d.chiave"
                    :tono="mediaManager.salute[d.chiave] ? 'successo' : 'avviso'"
                  >
                    {{ d.etichetta }} ({{ d.a_cosa_serve }}):
                    {{ mediaManager.salute[d.chiave] ? 'attivo' : 'assente' }}
                  </BaseBadge>
                </template>
              </p>
            </div>
          </BaseField>

          <BaseField
            v-slot="{ id, describedBy }"
            label="Chiave API"
            hint="Viaggia nell’intestazione X-API-Key ed è conservata in chiaro in questo browser. Non è un’identità e non firma nulla, ma resta una credenziale."
          >
            <BaseInput
              :id="id"
              v-model="bozzaServizi.chiave"
              type="password"
              :described-by="describedBy"
            />
          </BaseField>

          <BaseAlert v-for="(o, i) in mediaManager.ostacoli" :key="i" tono="pericolo">
            {{ o }}
          </BaseAlert>

          <BaseAlert v-if="serviziSalvati" tono="successo">
            Salvato. Un campo lasciato vuoto torna al valore del .env, invece di restare senza.
          </BaseAlert>

          <div class="flex flex-wrap gap-2">
            <BaseButton type="submit" variant="primario" :loading="mediaManager.verificaInCorso">
              Salva e verifica
            </BaseButton>
            <BaseButton
              v-if="mediaManager.personalizzato"
              variant="fantasma"
              @click="ripristinaServizi"
            >
              Torna ai valori del .env
            </BaseButton>
          </div>
        </form>
      </BaseCard>

      <!-- ─────────── External reading clients ─────────── -->
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

      <!-- ─────────── Publishing strategy ─────────── -->
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

      <!-- ─────────── Podcast import ─────────── -->
      <BaseCard
        title="Importare un podcast"
        subtitle="Quanto copiare su Blossom in una volta sola, quando porti qui un podcast da un altro host."
      >
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="salvaLimite">
          <BaseField
            v-slot="{ id, describedBy }"
            label="Limite di sicurezza per importazione (GB)"
            hint="Oltre questo peso l’import procede a lotti: i più recenti prima, il resto rilanciandolo. Gli episodi già importati vengono saltati."
            :error="erroreLimite ?? undefined"
          >
            <BaseInput
              :id="id"
              v-model="limiteGb"
              :described-by="describedBy"
              :invalid="!!erroreLimite"
              inputmode="decimal"
              @change="salvaLimite"
            />
          </BaseField>
        </form>
      </BaseCard>
    </ClientOnly>
  </div>
</template>
