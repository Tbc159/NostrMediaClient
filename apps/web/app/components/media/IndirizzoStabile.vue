<script setup lang="ts">
import {
  normalizzaBaseUrl,
  recordCname,
  urlSottodominio,
  validaDominio,
  validaSottodominio,
  type RecordDns,
} from '@nmc/nostr-core'

import { useMediaManager } from '~/stores/mediamanager'

/**
 * The feed's stable address, in the podcast's card.
 *
 * The address the apps subscribe to *is* the podcast: it has to be a name the
 * creator controls, not the service's. Three ways to get one. The first and
 * the third work today; the CNAME waits for the NMC domain and runs as a
 * simulation that applies nothing. The managed subdomain lives under the
 * configured suffix (`duckdns.org` until the NMC domain exists), and until the
 * service hands names out by itself the operator turns each one on by hand.
 * Either way the model is set only when the address has passed its check: it
 * must serve this key's feed.
 */

const props = defineProps<{
  /** The address already in the published card, if any. */
  salvato?: string | null
  /** The podcast's key, when the card is edited through a delegation. */
  pubkey?: string | null
}>()

const indirizzo = defineModel<string>({ default: '' })

const identita = useIdentity()
const servizio = useMediaManager()
const verifica = useIndirizzoStabile(() => props.pubkey)
/** The managed modes sign with the podcast's key: not possible from a delegation. */
const altraChiave = computed(() => !!props.pubkey && props.pubkey !== identita.pubkey)
const domini = useDominiGestiti()

type Modo = 'intermediario' | 'cname' | 'sottodominio'
const modo = ref<Modo>('intermediario')
const cambiando = ref(!props.salvato)
watch(
  () => props.salvato,
  (s) => {
    cambiando.value = !s
  },
)

onMounted(() => void domini.leggiCapacita())

/** A changed address, or another mode, is an unchecked one. */
function dimenticaVerifica(): void {
  indirizzo.value = props.salvato ?? ''
  verifica.stato.value = 'da-leggere'
  verifica.errore.value = null
  verifica.esito.value = null
}
watch(modo, dimenticaVerifica)

// ── (1) through an intermediary ──────────────────────────────────────────
const scritto = ref('')
watch(scritto, dimenticaVerifica)

const parti = computed(() => {
  try {
    const u = new URL(scritto.value.trim())
    return { host: u.host, percorso: u.pathname === '/' ? '/feed.xml' : u.pathname }
  } catch {
    return { host: 'feed.tuodominio.it', percorso: '/podcast.xml' }
  }
})
const tecnico = computed(() => verifica.urlTecnico.value ?? 'https://servizio/v0/feed/npub….xml')
const hostServizio = computed(() => {
  try {
    return new URL(normalizzaBaseUrl(servizio.baseUrl)).host
  } catch {
    return 'servizio'
  }
})

const esempi = computed(() => [
  {
    nome: 'Caddy',
    testo: `${parti.value.host} {
	handle ${parti.value.percorso} {
		rewrite * ${new URL(tecnico.value).pathname}
		reverse_proxy https://${hostServizio.value} {
			header_up Host {upstream_hostport}
		}
	}
}`,
  },
  {
    nome: 'nginx',
    testo: `server {
    listen 443 ssl;
    server_name ${parti.value.host};
    # ssl_certificate e ssl_certificate_key del tuo dominio

    location = ${parti.value.percorso} {
        proxy_pass ${tecnico.value};
        proxy_set_header Host ${hostServizio.value};
        proxy_ssl_server_name on;
    }
}`,
  },
  {
    nome: 'Cloudflare Worker',
    testo: `export default {
  async fetch(request) {
    if (new URL(request.url).pathname !== '${parti.value.percorso}') {
      return new Response('Not found', { status: 404 })
    }
    const feed = await fetch('${tecnico.value}', {
      headers: { accept: 'application/rss+xml' },
    })
    // Le intestazioni del servizio passano così come sono, CORS compreso.
    return new Response(feed.body, { status: feed.status, headers: feed.headers })
  },
}`,
  },
])

async function verificaIntermediario(): Promise<void> {
  const esito = await verifica.verifica(scritto.value)
  if (esito?.stessoFeed) indirizzo.value = scritto.value.trim()
}

// ── (2) CNAME ────────────────────────────────────────────────────────────
const dominio = ref('')
const esitoDominio = computed(() => (dominio.value.trim() ? validaDominio(dominio.value) : null))
const recordDominio = computed<RecordDns[]>(() =>
  esitoDominio.value?.ok
    ? recordCname(
        esitoDominio.value.nome,
        domini.destinazioneCname.value,
        props.pubkey || identita.pubkey || '00'.repeat(32),
      )
    : [],
)
const statoCname = ref<{ testo: string; tono: 'info' | 'successo' | 'pericolo' } | null>(null)
const inCname = ref(false)

async function dichiaraCname(): Promise<void> {
  if (!esitoDominio.value?.ok) return
  if (domini.cnameAttivo.value && altraChiave.value) {
    statoCname.value = { tono: 'pericolo', testo: 'Dichiara il dominio dalla chiave del podcast.' }
    return
  }
  statoCname.value = null
  inCname.value = true
  try {
    const esito = await domini.cname.value.dichiaraCname(esitoDominio.value.nome)
    if (domini.cname.value.modo === 'simulata') {
      statoCname.value = {
        tono: 'info',
        testo:
          'Prova completata: questi sarebbero i record. Niente è stato inviato al servizio, e l’indirizzo non viene salvato.',
      }
    } else if (esito.attivo && esito.url) {
      indirizzo.value = esito.url
      statoCname.value = { tono: 'successo', testo: `Dominio attivo: il feed è su ${esito.url}.` }
    } else {
      statoCname.value = {
        tono: 'info',
        testo:
          'Dominio dichiarato: il servizio lo attiva quando vede i due record. Torna a controllare dopo averli aggiunti.',
      }
    }
  } catch (e) {
    statoCname.value = { tono: 'pericolo', testo: e instanceof Error ? e.message : String(e) }
  } finally {
    inCname.value = false
  }
}

// ── (3) managed subdomain ────────────────────────────────────────────────
const nome = ref('')
const esitoNome = computed(() => (nome.value.trim() ? validaSottodominio(nome.value) : null))
const anteprima = computed(() =>
  esitoNome.value?.ok ? urlSottodominio(esitoNome.value.nome, domini.suffisso.value) : null,
)
const statoNome = ref<{ testo: string; tono: 'info' | 'successo' | 'pericolo' } | null>(null)
const inNome = ref(false)
watch(nome, () => {
  dimenticaVerifica()
  statoNome.value = null
})

async function registraNome(): Promise<void> {
  if (!esitoNome.value?.ok) return
  if (domini.sottodominiAttivi.value && altraChiave.value) {
    statoNome.value = { tono: 'pericolo', testo: 'Registra il nome dalla chiave del podcast.' }
    return
  }
  const scelto = esitoNome.value.nome
  statoNome.value = null
  inNome.value = true
  try {
    const libero = await domini.sottodomini.value.disponibile(scelto)
    if (!libero.libero) {
      statoNome.value = {
        tono: 'pericolo',
        testo: libero.motivo ?? `«${scelto}» è già stato preso: scegline un altro.`,
      }
      return
    }
    const { url } = await domini.sottodomini.value.registra(scelto)
    // The name is kept only if it already serves this key's feed: until the
    // service hands names out, the operator turns each one on by hand.
    const esito = await verifica.verifica(url)
    if (esito?.stessoFeed) {
      indirizzo.value = url
      statoNome.value = {
        tono: 'successo',
        testo: `Il nome è attivo: il feed è su ${url}, e verrà scritto nella scheda alla pubblicazione.`,
      }
    } else if (!esito) {
      statoNome.value = {
        tono: 'pericolo',
        testo: `${url} non serve ancora il feed: il nome non è attivo. L’operatore di NMC deve configurarlo; poi riprova.`,
      }
    }
  } catch (e) {
    statoNome.value = { tono: 'pericolo', testo: e instanceof Error ? e.message : String(e) }
  } finally {
    inNome.value = false
  }
}

const copiato = ref<string | null>(null)
async function copia(testo: string, chi: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(testo)
    copiato.value = chi
    setTimeout(() => (copiato.value = null), 2000)
  } catch {
    // Clipboard denied: the text is selectable all the same.
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h3 class="text-sm font-medium">Indirizzo stabile del feed</h3>
    <p class="text-xs text-[var(--testo-tenue)]">
      L’indirizzo a cui le app si iscrivono è il podcast: dev’essere un nome tuo, non quello tecnico
      del servizio. Senza un indirizzo stabile e verificato, NMC non mostra e non consegna l’URL del
      feed.
    </p>

    <div v-if="salvato && !cambiando" class="flex flex-col gap-2">
      <p class="text-sm">
        Indirizzo attuale:
        <code class="break-all">{{ salvato }}</code>
      </p>
      <BaseAlert tono="avviso">
        Cambiarlo vuol dire un trasloco: il vecchio indirizzo deve rispondere con un redirect 301
        verso il nuovo, e il feed dichiarare il nuovo in
        <code>itunes:new-feed-url</code>
        , per almeno quattro settimane. Si può fare solo se il vecchio nome è ancora tuo.
      </BaseAlert>
      <BaseButton size="sm" class="w-fit" @click="cambiando = true">Cambia indirizzo</BaseButton>
    </div>

    <template v-else>
      <fieldset class="flex flex-col gap-2 text-sm">
        <legend class="sr-only">Come il tuo dominio arriva al feed</legend>
        <label
          class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
          :class="modo === 'intermediario' && 'border-[var(--accento)]'"
        >
          <input v-model="modo" type="radio" value="intermediario" class="mt-1" />
          <span class="flex flex-col gap-1">
            <span class="font-medium">Il tuo dominio, con un intermediario</span>
            <span class="text-xs text-[var(--testo-tenue)]">
              Un tuo server (Caddy, nginx, un Cloudflare Worker) chiede il feed al servizio e lo
              restituisce. Il nome è tuo; se un giorno cambi servizio, cambi solo l’intermediario.
            </span>
          </span>
        </label>
        <label
          class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
          :class="modo === 'cname' && 'border-[var(--accento)]'"
        >
          <input v-model="modo" type="radio" value="cname" class="mt-1" />
          <span class="flex flex-col gap-1">
            <span class="flex flex-wrap items-center gap-2 font-medium">
              Il tuo dominio, puntato al servizio (CNAME)
              <BaseBadge v-if="!domini.cnameAttivo.value" tono="avviso">Coming soon</BaseBadge>
            </span>
            <span class="text-xs text-[var(--testo-tenue)]">
              Due record dal tuo registrar e nient’altro: il servizio emette il certificato. Il nome
              resta tuo.
            </span>
          </span>
        </label>
        <label
          class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
          :class="modo === 'sottodominio' && 'border-[var(--accento)]'"
        >
          <input v-model="modo" type="radio" value="sottodominio" class="mt-1" />
          <span class="flex flex-col gap-1">
            <span class="flex flex-wrap items-center gap-2 font-medium">
              Un sottodominio di NMC
            </span>
            <span class="text-xs text-[var(--testo-tenue)]">
              Il più semplice: scegli un nome e NMC configura tutto. Il nome però è dell’operatore,
              non tuo.
            </span>
          </span>
        </label>
      </fieldset>

      <!-- ── (1) ── -->
      <div v-if="modo === 'intermediario'" class="flex flex-col gap-3">
        <BaseField
          v-slot="{ id, describedBy }"
          label="Indirizzo completo del feed sul tuo dominio"
          hint="Per esempio https://feed.mariarossi.it/podcast.xml. Qualunque percorso va bene."
        >
          <BaseInput
            :id="id"
            v-model="scritto"
            :described-by="describedBy"
            placeholder="https://feed.tuodominio.it/podcast.xml"
          />
        </BaseField>
        <details class="superficie rounded-md border p-3">
          <summary class="cursor-pointer text-sm">Come configurare l’intermediario</summary>
          <div class="mt-2 flex flex-col gap-3 text-xs">
            <p>
              L’intermediario chiede il feed all’indirizzo tecnico di questa chiave e lo restituisce
              con un 200, insieme alle intestazioni del servizio (compresa quella CORS, che serve a
              NMC per verificarlo).
              <strong>Mai un redirect:</strong>
              le app seguirebbero il 301 e memorizzerebbero l’indirizzo tecnico.
            </p>
            <div v-for="e in esempi" :key="e.nome" class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <strong>{{ e.nome }}</strong>
                <button type="button" class="underline" @click="copia(e.testo, e.nome)">
                  {{ copiato === e.nome ? 'copiato' : 'copia' }}
                </button>
              </div>
              <pre class="overflow-x-auto rounded-md bg-[var(--sfondo-alt)] p-2 font-mono">{{
                e.testo
              }}</pre>
            </div>
            <p class="text-[var(--testo-tenue)]">
              L’intermediario punta all’indirizzo tecnico: quando le API passeranno al dominio di
              NMC andrà aggiornato. Il tuo indirizzo, quello che le app conoscono, non cambia.
            </p>
          </div>
        </details>
        <div class="flex flex-wrap items-center gap-2">
          <BaseButton
            variant="primario"
            :loading="verifica.stato.value === 'in-verifica'"
            :disabled="!scritto.trim()"
            @click="verificaIntermediario"
          >
            Verifica indirizzo
          </BaseButton>
          <span v-if="indirizzo && indirizzo === scritto.trim()" class="text-sm">
            ✓ verificato: verrà scritto nella scheda alla pubblicazione
          </span>
        </div>
      </div>

      <!-- ── (2) ── -->
      <div v-else-if="modo === 'cname'" class="flex flex-col gap-3">
        <BaseAlert v-if="!domini.cnameAttivo.value" tono="avviso">
          Coming soon: funzionerà quando NMC avrà il suo dominio. Puoi provare il percorso, ma non
          applica niente.
        </BaseAlert>
        <BaseField v-slot="{ id }" label="Il tuo dominio (o sottodominio)">
          <BaseInput :id="id" v-model="dominio" placeholder="feed.tuodominio.it" />
        </BaseField>
        <p
          v-if="esitoDominio && !esitoDominio.ok"
          role="alert"
          class="text-xs text-[var(--pericolo)]"
        >
          {{ esitoDominio.motivo }}
        </p>
        <template v-if="recordDominio.length">
          <p class="text-sm">Da aggiungere nel pannello del tuo registrar:</p>
          <table class="text-left text-xs">
            <thead>
              <tr>
                <th class="pr-3">Tipo</th>
                <th class="pr-3">Nome</th>
                <th>Valore</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in recordDominio" :key="r.tipo">
                <td class="pr-3 font-mono">{{ r.tipo }}</td>
                <td class="pr-3 font-mono">{{ r.nome }}</td>
                <td class="break-all font-mono">{{ r.valore }}</td>
              </tr>
            </tbody>
          </table>
          <p class="text-xs text-[var(--testo-tenue)]">
            Il CNAME porta le richieste al servizio; il TXT con la tua npub prova che il dominio è
            di questa chiave.
          </p>
          <BaseButton class="w-fit" :loading="inCname" @click="dichiaraCname">
            {{ domini.cnameAttivo.value ? 'Dichiara il dominio' : 'Prova' }}
          </BaseButton>
        </template>
        <BaseAlert v-if="statoCname" :tono="statoCname.tono">{{ statoCname.testo }}</BaseAlert>
      </div>

      <!-- ── (3) ── -->
      <div v-else class="flex flex-col gap-3">
        <BaseField
          v-slot="{ id, describedBy }"
          label="Nome del sottodominio"
          hint="Da 3 a 63 caratteri: lettere minuscole, cifre e trattini."
        >
          <BaseInput :id="id" v-model="nome" :described-by="describedBy" placeholder="mariarossi" />
        </BaseField>
        <p v-if="esitoNome && !esitoNome.ok" role="alert" class="text-xs text-[var(--pericolo)]">
          {{ esitoNome.motivo }}
        </p>
        <p v-else-if="anteprima" class="text-sm">
          Il feed sarà su
          <code class="break-all">{{ anteprima }}</code>
        </p>
        <p class="text-xs text-[var(--testo-tenue)]">
          Il nome è dell’operatore di NMC, che si impegna a mantenere un redirect 301 verso il tuo
          nuovo feed se un giorno te ne vai. Cambiarlo vorrà dire un trasloco.
          <template v-if="!domini.sottodominiAttivi.value">
            Per ora l’operatore attiva ogni nome a mano: NMC lo salva solo quando serve davvero il
            feed di questa chiave.
          </template>
        </p>
        <BaseButton
          class="w-fit"
          :loading="inNome"
          :disabled="!esitoNome?.ok"
          @click="registraNome"
        >
          {{ domini.sottodominiAttivi.value ? 'Registra il nome' : 'Usa questo nome' }}
        </BaseButton>
        <BaseAlert v-if="statoNome" :tono="statoNome.tono">{{ statoNome.testo }}</BaseAlert>
      </div>

      <!-- The check of (1) and (3): the address must serve this key's feed. -->
      <template v-if="modo !== 'cname'">
        <BaseAlert v-if="verifica.errore.value" tono="pericolo">
          {{ verifica.errore.value }}
        </BaseAlert>
        <template v-else-if="verifica.esito.value">
          <BaseAlert v-if="verifica.esito.value.stessoFeed" tono="successo">
            È il feed di questa chiave: stessa identità, stessi episodi.
          </BaseAlert>
          <BaseAlert
            v-for="p in verifica.esito.value.problemi"
            :key="p"
            :tono="verifica.esito.value.stessoFeed ? 'info' : 'pericolo'"
          >
            {{ p }}
          </BaseAlert>
        </template>
      </template>

      <p class="text-xs text-[var(--testo-tenue)]">
        Qualunque modo scegli, cambiarlo in futuro è un trasloco: redirect 301 dal vecchio indirizzo
        e
        <code>itunes:new-feed-url</code>
        per almeno quattro settimane, possibile solo se il vecchio nome è ancora tuo.
      </p>
      <BaseButton
        v-if="salvato"
        size="sm"
        variant="fantasma"
        class="w-fit"
        @click="((cambiando = false), (indirizzo = salvato ?? ''))"
      >
        Tieni l’indirizzo attuale
      </BaseButton>
    </template>
  </section>
</template>
