<script setup lang="ts">
import {
  chiama,
  episodiFuoriDalFeed,
  opmlPerFeed,
  getKindDefinition,
  riassumiFeedPodcast,
  spiegaStato,
  urlFeedPodcast,
  type RiassuntoFeed,
} from '@nmc/nostr-core'
import { useMediaManager } from '~/stores/mediamanager'

/**
 * Il feed RSS del podcast di questa chiave.
 *
 * Il client non lo genera — lo serve il dominio `feed` del media-manager,
 * pubblico e senza chiave — ma lo *governa*: mostra l'URL, lo verifica
 * davvero scaricandolo e leggendolo, e dice cosa un'app di podcast
 * rifiuterebbe. E' anche il posto dove si spiega dove sottoporlo: senza un
 * feed su Podcast Index, per Fountain e gli altri il podcast non esiste.
 */

const identita = useIdentity()
const servizio = useMediaManager()

const url = computed(() => {
  if (!identita.pubkey || !servizio.configurato) return null
  try {
    return urlFeedPodcast(servizio.baseUrl, identita.pubkey)
  } catch {
    return null
  }
})

/*
 * Gli episodi che *questo client* vede sui relay di lettura: il termine di
 * paragone per il feed. Un episodio qui e non la' sta su un relay da cui il
 * servizio non legge — e il rimedio e' ridistribuirlo, non ripubblicarlo.
 */
const pubblicati = useEventiPropri([54], { limite: 200 })

/*
 * La scheda 10154 come sta sui relay: serve a distinguere «il dato manca»
 * da «il dato c'e' ma il servizio non lo legge ancora». Sono due cose
 * diverse, con due rimedi diversi — il profilo, oppure il Prompt H.
 */
const schedaEsistente = useEventoEsistente()
const tagNellaScheda = ref<{ categoria: boolean; email: boolean } | null>(null)

/*
 * Ridistribuire tutto cio' che il feed legge — la scheda e gli episodi — a
 * tutti i relay di scrittura. E' l'azione «a prescindere»: non serve un
 * episodio nuovo per accorgersi che la scheda modificata ieri sta su un
 * relay solo, e da «Eventi» il collegamento e' facile da non vedere.
 */
const ridistribuzione = useRidistribuzione()
const titoloEvento = (e: { tags: string[][]; id: string }): string =>
  e.tags.find((t) => t[0] === 'title')?.[1] ?? e.id.slice(0, 12)

async function ridistribuisciTutto(): Promise<void> {
  if (!pubblicati.eventi.value.length) await pubblicati.carica()
  if (!schedaEsistente.evento.value) await leggiScheda()
  const scheda = schedaEsistente.evento.value
  await ridistribuzione.ridistribuisci([
    ...(scheda ? [{ evento: scheda, etichetta: 'Scheda del podcast' }] : []),
    ...pubblicati.eventi.value.map((e) => ({ evento: e, etichetta: `«${titoloEvento(e)}»` })),
  ])
}

async function leggiScheda(): Promise<void> {
  const trovato = await schedaEsistente.perCoordinata(10154)
  const definizione = getKindDefinition(10154)
  if (!trovato || !definizione) {
    tagNellaScheda.value = null
    return
  }
  try {
    const dati = definizione.parse(trovato) as { categories: unknown[]; email?: string }
    tagNellaScheda.value = { categoria: dati.categories.length > 0, email: !!dati.email }
  } catch {
    tagNellaScheda.value = null
  }
}

/** I dati che stanno nella scheda ma non nel feed: il servizio non li legge ancora. */
const nonLettiDalServizio = computed(() => {
  const r = riassunto.value
  const t = tagNellaScheda.value
  if (!r || !t) return []
  const mancanti: string[] = []
  if (t.categoria && !r.categoria) mancanti.push('la categoria')
  if (t.email && !r.email) mancanti.push('l’email')
  return mancanti
})
const fuoriDalFeed = computed(() =>
  riassunto.value
    ? episodiFuoriDalFeed(
        riassunto.value,
        pubblicati.eventi.value.map((e) => ({ id: e.id, titolo: titoloEvento(e) })),
      )
    : [],
)

const verificaInCorso = ref(false)
const riassunto = ref<RiassuntoFeed | null>(null)
const errore = ref<string | null>(null)
const copiato = ref(false)
/**
 * Per quanto il servizio tiene una copia del feed (`max-age`), in secondi.
 *
 * Conta per leggere l'esito: un episodio appena pubblicato, o un relay
 * lento al momento in cui il servizio ha costruito il feed, restano fuori
 * per tutta la durata della copia. Non e' un guasto e non si rimedia
 * ripubblicando: si aspetta.
 */
const copiaServizioS = ref<number | null>(null)

async function verifica(): Promise<void> {
  if (!url.value) return
  verificaInCorso.value = true
  errore.value = null
  riassunto.value = null
  try {
    // Prima gli episodi e la scheda dai relay, cosi' il confronto e' pronto insieme al feed.
    await Promise.all([
      pubblicati.eventi.value.length ? Promise.resolve() : pubblicati.carica(),
      leggiScheda(),
    ])
    // `no-store`: il browser terrebbe la copia per `max-age` e «Verifica» dopo
    // una pubblicazione mostrerebbe il feed di prima. La copia del servizio
    // invece resta, e si dice.
    const risposta = await chiama(url.value, {
      headers: { accept: 'application/rss+xml' },
      cache: 'no-store',
    })
    if (risposta.status === 404) {
      // Il servizio distingue «nessuna scheda» da «endpoint assente»: il
      // corpo lo dice, e vale la pena ripeterlo.
      let dettaglio = ''
      try {
        dettaglio = ((await risposta.json()) as { detail?: string }).detail ?? ''
      } catch {
        // corpo non JSON: probabilmente il dominio feed non e' deployato
      }
      errore.value =
        dettaglio ||
        'Il servizio non ha un dominio feed (404): questa parte del media-manager non è ancora pubblicata.'
      return
    }
    if (!risposta.ok) {
      errore.value = spiegaStato(risposta.status)
      return
    }
    const maxAge = /max-age=(\d+)/.exec(risposta.headers.get('cache-control') ?? '')?.[1]
    copiaServizioS.value = maxAge ? Number(maxAge) : null
    riassunto.value = riassumiFeedPodcast(await risposta.text())
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  } finally {
    verificaInCorso.value = false
  }
}

async function copia(): Promise<void> {
  if (!url.value) return
  try {
    await navigator.clipboard.writeText(url.value)
    copiato.value = true
    setTimeout(() => (copiato.value = false), 2000)
  } catch {
    // Appunti negati: l'URL e' comunque selezionabile nel campo.
  }
}

/**
 * L'OPML: il feed impacchettato come abbonamento.
 *
 * Il titolo e' **sempre** quello letto dal feed: se non e' stato verificato
 * si verifica prima. Un titolo generico qui non e' innocuo — Fountain cerca
 * ogni voce dell'OPML nel proprio catalogo *per titolo*, e un OPML con
 * «Podcast» ha fatto iscrivere a 127 show che si chiamano cosi'. E' successo.
 */
const erroreOpml = ref<string | null>(null)

async function scaricaOpml(): Promise<void> {
  if (!url.value) return
  erroreOpml.value = null
  if (!riassunto.value) await verifica()
  const titolo = riassunto.value?.titolo.trim()
  if (!titolo) {
    erroreOpml.value =
      'Prima serve un feed verificato con un titolo: senza, l’OPML porterebbe un nome generico e le app iscriverebbero a show sbagliati.'
    return
  }
  const opml = opmlPerFeed({ titolo, urlFeed: url.value })
  const blob = new Blob([opml], { type: 'text/x-opml' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${titolo.replace(/[^\w-]+/g, '-').toLowerCase()}.opml`
  a.click()
  URL.revokeObjectURL(href)
}

const ultimo = computed(() => riassunto.value?.episodi[0] ?? null)
const copiaLeggibile = computed(() => {
  const s = copiaServizioS.value
  if (!s) return null
  return s >= 120 ? `${Math.round(s / 60)} minuti` : `${s} secondi`
})
const dataLeggibile = (d: Date | null): string =>
  d ? d.toLocaleDateString('it-IT', { dateStyle: 'medium' }) : 'data assente'
</script>

<template>
  <BaseCard
    title="Feed RSS"
    subtitle="La scheda qui sopra e gli episodi, visti dalle app che non parlano Nostr: Fountain, Apple, Podcast Index."
  >
    <div class="flex flex-col gap-4">
      <BaseAlert v-if="!identita.pubkey" tono="avviso">
        Serve un’identità: il feed è quello della chiave che pubblica gli episodi.
      </BaseAlert>
      <BaseAlert v-else-if="!servizio.configurato" tono="avviso">
        Nessun servizio configurato: il feed lo serve il media-manager.
        <NuxtLink to="/impostazioni" class="underline">Impostazioni</NuxtLink>
      </BaseAlert>

      <template v-else-if="url">
        <div class="flex flex-wrap items-center gap-2">
          <input
            readonly
            :value="url"
            class="superficie min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <BaseButton size="sm" @click="copia">{{ copiato ? 'Copiato' : 'Copia' }}</BaseButton>
          <BaseButton size="sm" variant="primario" :loading="verificaInCorso" @click="verifica">
            Verifica
          </BaseButton>
          <BaseButton size="sm" :loading="verificaInCorso" @click="scaricaOpml">
            Scarica OPML
          </BaseButton>
          <BaseButton
            size="sm"
            :loading="ridistribuzione.inCorso.value"
            :disabled="!identita.puoFirmare"
            title="Manda la scheda del podcast e tutti gli episodi, già firmati, a tutti i relay di scrittura: chi li ha già lo dice, nessun duplicato."
            @click="ridistribuisciTutto"
          >
            Ridistribuisci sui relay
          </BaseButton>
        </div>

        <template v-if="ridistribuzione.esiti.value.length">
          <ul class="text-xs text-[var(--testo-tenue)]">
            <li v-for="e in ridistribuzione.esiti.value" :key="e.id">
              {{ e.etichetta }}: {{ ridistribuzione.riga(e) }}
            </li>
          </ul>
          <p class="text-xs text-[var(--testo-tenue)]">
            Il servizio tiene una copia del feed per qualche minuto: verifica di nuovo fra poco.
          </p>
        </template>
        <BaseAlert v-if="ridistribuzione.errore.value" tono="pericolo">
          {{ ridistribuzione.errore.value }}
        </BaseAlert>

        <BaseAlert v-if="erroreOpml" tono="pericolo">{{ erroreOpml }}</BaseAlert>

        <p class="text-xs text-[var(--testo-tenue)]">
          Il feed si costruisce da solo dai tuoi eventi: la scheda del podcast (kind 10154) diventa
          il canale, ogni episodio (kind 54) una voce. Non c’è nulla da rigenerare quando pubblichi.
        </p>

        <BaseAlert v-if="errore" tono="pericolo">{{ errore }}</BaseAlert>

        <template v-if="riassunto">
          <BaseAlert :tono="riassunto.problemi.length ? 'avviso' : 'successo'">
            <strong>{{ riassunto.titolo || '(senza titolo)' }}</strong>
            — {{ riassunto.episodi.length }}
            {{ riassunto.episodi.length === 1 ? 'episodio' : 'episodi' }}
            <template v-if="ultimo">
              , l’ultimo «{{ ultimo.titolo }}» del {{ dataLeggibile(ultimo.data) }}
            </template>
            .
            <span v-if="riassunto.relays.length" class="mt-1 block text-xs">
              Letto da: {{ riassunto.relays.join(', ') }}
            </span>
          </BaseAlert>

          <ul v-if="riassunto.problemi.length" class="list-inside list-disc text-sm">
            <li v-for="(p, i) in riassunto.problemi" :key="i">{{ p }}</li>
          </ul>

          <BaseAlert v-if="nonLettiDalServizio.length" tono="info">
            {{ nonLettiDalServizio.join(' e ') }}
            {{ nonLettiDalServizio.length === 1 ? 'sta' : 'stanno' }} nella scheda del podcast ma
            non nel feed: il servizio non legge ancora quei tag. Non è un dato da aggiungere — è il
            servizio da aggiornare (Prompt H in
            <code>doc/api-da-sviluppare.md</code>
            ).
          </BaseAlert>

          <BaseAlert v-if="fuoriDalFeed.length" tono="avviso">
            <strong>
              {{ fuoriDalFeed.length }}
              {{
                fuoriDalFeed.length === 1
                  ? 'episodio pubblicato non è'
                  : 'episodi pubblicati non sono'
              }}
              nel feed
            </strong>
            : {{ fuoriDalFeed.map((e) => `«${e.titolo}»`).join(', ') }}. Due cause possibili, in
            ordine di probabilità:
            <ol class="mt-1 list-inside list-decimal">
              <li>
                un relay non ha risposto in tempo quando il servizio ha costruito il feed
                <template v-if="copiaLeggibile">
                  — e il servizio ne tiene una copia per {{ copiaLeggibile }}
                </template>
                : se l’episodio nel feed c’era fino a poco fa, non è sparito. Riprova fra qualche
                minuto.
              </li>
              <li>
                l’episodio sta su un relay da cui il servizio non legge (qui sopra c’è l’elenco):
                «Ridistribuisci sui relay» lo porta anche lì; poi verifica di nuovo.
              </li>
            </ol>
          </BaseAlert>
          <BaseAlert v-else-if="!riassunto.episodi.length" tono="info">
            Zero episodi nel feed, e nessuno visto sui tuoi relay di lettura: pubblica il primo
            dalla scheda qui sopra.
          </BaseAlert>
        </template>

        <details class="superficie rounded-md border p-3">
          <summary class="cursor-pointer text-sm font-medium">Dove sottoporlo</summary>
          <ol class="mt-2 list-inside list-decimal space-y-1 text-sm">
            <li>
              Verifica qui sopra che il feed sia senza problemi: le directory rifiutano un feed
              senza immagine, lingua o
              <code>itunes:explicit</code>
              .
            </li>
            <li>
              <strong>Prima di tutto</strong>
              , sottoponi l’URL a
              <a
                href="https://podcastindex.org/add"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >
                Podcast Index
              </a>
              . Fountain non segue indirizzi arbitrari: segue solo show del suo catalogo, che è
              Podcast Index. Finché il feed non è lì, in Fountain non si trova — né cercandolo, né
              importandolo.
            </li>
            <li>
              Dopo qualche ora, cerca lo show in Fountain per titolo; poi
              <a
                href="https://support.fountain.fm/article/56-how-to-claim-your-show-on-fountain"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >
                rivendicalo
              </a>
              come tuo.
            </li>
            <li>
              Apple Podcasts e Spotify vanno sottoposti a parte, con un loro account: usano lo
              stesso URL.
            </li>
            <li>
              L’OPML serve per far seguire lo show a qualcuno con un file, ma vale la stessa regola:
              le app che seguono solo il proprio catalogo (Fountain) lo trovano
              <em>dopo</em>
              l’indicizzazione, per titolo; quelle che seguono l’URL (Overcast, Podcast Addict,
              AntennaPod) lo seguono subito. Per questo l’OPML porta sempre il titolo vero del feed,
              mai uno generico.
            </li>
          </ol>
          <p class="mt-2 text-xs text-[var(--testo-tenue)]">
            L’URL è legato alla tua chiave e al servizio: se cambi servizio, cambia il feed, e le
            app che lo seguono vanno avvisate.
          </p>
        </details>
      </template>
    </div>
  </BaseCard>
</template>
