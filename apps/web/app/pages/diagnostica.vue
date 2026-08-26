<script setup lang="ts">
import { checkBlossomServer, checkRelay, type BlossomCheck, type RelayCheck } from '@nmc/nostr-core'

useHead({ title: 'Diagnostica · NostrMediaClient' })

type Stato = 'attesa' | 'incorso' | 'fatto'

interface RigaRelay {
  url: string
  ruoli: string[]
  stato: Stato
  esito?: RelayCheck
  errore?: string
}

interface RigaBlossom {
  url: string
  stato: Stato
  esito?: BlossomCheck
  errore?: string
}

const NIP_INTERESSANTI: Record<number, string> = {
  1: 'base',
  9: 'cancellazione',
  11: 'info relay',
  17: 'DM privati',
  22: 'commenti',
  23: 'long-form',
  42: 'AUTH',
  50: 'ricerca',
  52: 'calendario',
  65: 'outbox',
}

// La configurazione puo' essere invalida: in quel caso mostriamo l'errore
// invece di far esplodere la pagina.
const erroreConfig = ref<string | null>(null)
const relays = ref<RigaRelay[]>([])
const blossom = ref<RigaBlossom[]>([])
const draftRelayConfigurato = ref(true)
const inCorso = ref(false)

// Orario dell'ultima verifica completata. Senza, una pagina lasciata aperta
// mostra risultati vecchi identici a quelli freschi: chi guarda non ha modo
// di accorgersi che il server e' stato riavviato o che .env e' cambiato.
const ultimaVerifica = ref<Date | null>(null)

try {
  const config = useClientConfig()
  draftRelayConfigurato.value = config.draftRelay !== null
  relays.value = [...relayRoles(config)].map(([url, ruoli]) => ({ url, ruoli, stato: 'attesa' }))
  blossom.value = config.blossomServers.map((url) => ({ url, stato: 'attesa' }))
} catch (err) {
  erroreConfig.value = err instanceof Error ? err.message : String(err)
}

async function esegui(): Promise<void> {
  if (inCorso.value) return
  inCorso.value = true

  // In sequenza, non in parallelo: molti relay limitano le connessioni per IP
  // e sonde simultanee producono falsi negativi.
  for (const riga of relays.value) {
    riga.stato = 'incorso'
    riga.errore = undefined
    try {
      riga.esito = await checkRelay(riga.url)
    } catch (err) {
      riga.errore = err instanceof Error ? err.message : String(err)
    }
    riga.stato = 'fatto'
  }

  for (const riga of blossom.value) {
    riga.stato = 'incorso'
    riga.errore = undefined
    try {
      riga.esito = await checkBlossomServer(riga.url)
    } catch (err) {
      riga.errore = err instanceof Error ? err.message : String(err)
    }
    riga.stato = 'fatto'
  }

  ultimaVerifica.value = new Date()
  inCorso.value = false
}

onMounted(() => {
  if (!erroreConfig.value) void esegui()
})

const raggiungibili = computed(
  () =>
    relays.value.filter((r) => r.esito?.probe.reachable).length +
    blossom.value.filter((b) => b.esito?.reachable).length,
)
const totali = computed(() => relays.value.length + blossom.value.length)

const orarioVerifica = computed(() =>
  ultimaVerifica.value
    ? ultimaVerifica.value.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null,
)

function nipDichiarati(esito: RelayCheck): string[] {
  const nips = esito.info?.supported_nips ?? []
  return Object.entries(NIP_INTERESSANTI)
    .filter(([n]) => nips.includes(Number(n)))
    .map(([n, label]) => `${n} ${label}`)
}
</script>

<template>
  <main class="mx-auto max-w-3xl p-6 md:p-8">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">Diagnostica endpoint</h1>
      <p class="mt-1 text-sm text-neutral-500">
        Verifica i relay e i server Blossom configurati in
        <code class="rounded bg-neutral-500/10 px-1 py-0.5 text-xs">.env</code>
        . Tutte le prove sono anonime e in sola lettura: nessuna chiave viene usata.
      </p>
    </header>

    <div
      v-if="erroreConfig"
      class="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm"
      data-testid="errore-config"
    >
      <p class="font-medium text-red-600 dark:text-red-400">Configurazione non valida</p>
      <pre class="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{{ erroreConfig }}</pre>
    </div>

    <template v-else>
      <div class="mb-6 flex items-center gap-3">
        <button
          type="button"
          class="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          :disabled="inCorso"
          @click="esegui"
        >
          {{ inCorso ? 'Verifica in corso…' : 'Riesegui verifica' }}
        </button>
        <p class="text-sm text-neutral-500" data-testid="riepilogo">
          {{ raggiungibili }} / {{ totali }} raggiungibili
          <span v-if="orarioVerifica" class="text-neutral-400">
            · verificato alle {{ orarioVerifica }}
          </span>
        </p>
      </div>

      <section class="mb-8">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Relay ({{ relays.length }} unici)
        </h2>

        <ul class="space-y-3">
          <li
            v-for="riga in relays"
            :key="riga.url"
            class="rounded-lg border border-neutral-500/20 p-4"
            data-testid="riga-relay"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <code class="text-sm font-medium">{{ riga.url }}</code>
              <span class="text-xs text-neutral-500">{{ riga.ruoli.join(' · ') }}</span>
            </div>

            <p v-if="riga.stato !== 'fatto'" class="mt-2 text-sm text-neutral-500">
              {{ riga.stato === 'incorso' ? 'verifica in corso…' : 'in attesa' }}
            </p>

            <template v-else-if="riga.esito">
              <p
                v-if="riga.esito.probe.reachable"
                class="mt-2 text-sm text-green-600 dark:text-green-400"
              >
                ✓ risponde in
                {{ riga.esito.probe.firstDataMs ?? riga.esito.probe.connectMs }} ms
              </p>
              <p v-else class="mt-2 text-sm text-red-600 dark:text-red-400">
                ✗ {{ riga.esito.probe.error ?? 'nessun dato ricevuto' }}
              </p>

              <ul class="mt-2 space-y-1 text-xs text-neutral-500">
                <li v-if="riga.esito.probe.retried" class="text-amber-600 dark:text-amber-400">
                  ▲ il primo tentativo era fallito: relay instabile o con rate limit per IP
                </li>
                <li
                  v-if="riga.esito.probe.authRequested"
                  class="text-amber-600 dark:text-amber-400"
                >
                  ▲ richiede AUTH (NIP-42) anche solo per leggere
                </li>
                <li
                  v-if="riga.esito.info?.limitation?.payment_required"
                  class="text-amber-600 dark:text-amber-400"
                >
                  ▲ relay a pagamento — listino:
                  {{ riga.esito.info.payments_url ?? 'non indicato' }}
                </li>
                <li
                  v-if="riga.esito.info?.limitation?.restricted_writes"
                  class="text-amber-600 dark:text-amber-400"
                >
                  ▲ scrittura non aperta a tutti
                </li>
                <li v-if="riga.esito.info?.name">nome: {{ riga.esito.info.name }}</li>
                <li v-if="riga.esito.info?.software">
                  software: {{ riga.esito.info.software.split('/').pop() }}
                  {{ riga.esito.info.version }}
                </li>
                <li v-if="riga.esito.info">
                  NIP: {{ nipDichiarati(riga.esito).join(', ') || '—' }}
                </li>
                <li v-if="riga.esito.infoError">
                  NIP-11 non leggibile ({{ riga.esito.infoError }}) — spesso e' solo CORS dal
                  browser, non un guasto del relay
                </li>
              </ul>
            </template>

            <p v-else-if="riga.errore" class="mt-2 text-sm text-red-600 dark:text-red-400">
              ✗ {{ riga.errore }}
            </p>
          </li>
        </ul>

        <p v-if="!draftRelayConfigurato" class="mt-3 text-xs text-neutral-500">
          Relay bozze (kind 30024) non configurato: il salvataggio delle bozze resta disabilitato di
          proposito, invece di mandarle su un relay pubblico.
        </p>
      </section>

      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Server Blossom
        </h2>

        <p v-if="blossom.length === 0" class="text-sm text-amber-600 dark:text-amber-400">
          ▲ nessuno configurato: gli upload media non saranno possibili.
        </p>

        <ul v-else class="space-y-3">
          <li
            v-for="riga in blossom"
            :key="riga.url"
            class="rounded-lg border border-neutral-500/20 p-4"
            data-testid="riga-blossom"
          >
            <code class="text-sm font-medium">{{ riga.url }}</code>

            <p v-if="riga.stato !== 'fatto'" class="mt-2 text-sm text-neutral-500">
              {{ riga.stato === 'incorso' ? 'verifica in corso…' : 'in attesa' }}
            </p>

            <template v-else-if="riga.esito">
              <p
                v-if="riga.esito.speaksBlossom"
                class="mt-2 text-sm text-green-600 dark:text-green-400"
              >
                ✓ risponde 404 su un blob inesistente: parla Blossom (BUD-01)
              </p>
              <p v-else-if="riga.esito.reachable" class="mt-2 text-sm text-amber-600">
                ▲ raggiungibile ma non si comporta da server Blossom
              </p>
              <p v-else class="mt-2 text-sm text-red-600 dark:text-red-400">
                ✗ irraggiungibile: {{ riga.esito.error }}
              </p>

              <p v-if="riga.esito.uploadHint" class="mt-1 text-xs text-neutral-500">
                HEAD /upload → {{ riga.esito.uploadStatus ?? '?' }}: {{ riga.esito.uploadHint }}
              </p>
            </template>

            <p v-else-if="riga.errore" class="mt-2 text-sm text-red-600 dark:text-red-400">
              ✗ {{ riga.errore }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>
