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
 * The RSS feed of this key's podcast.
 *
 * The client does not generate it — the media-manager's `feed` domain serves
 * it, public and keyless — but it *governs* it: it shows the URL, really
 * checks it by downloading and reading it, and says what a podcast app would
 * refuse. It is also the place where where to submit it is explained: without
 * a feed on Podcast Index, for Fountain and the others the podcast does not
 * exist.
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
 * The episodes *this client* sees on the read relays: the yardstick for the
 * feed. An episode here and not there sits on a relay the service does not
 * read from — and the remedy is redistributing it, not republishing it.
 */
const pubblicati = useEventiPropri([54], { limite: 200 })

/*
 * The 10154 card as it stands on the relays: it is what tells «the datum is
 * missing» from «the datum is there but the service does not read it yet».
 * They are two different things, with two different remedies — the profile, or
 * Prompt H.
 */
const schedaEsistente = useEventoEsistente()
const tagNellaScheda = ref<{ categoria: boolean; email: boolean } | null>(null)

/*
 * Redistributing everything the feed reads — the card and the episodes — to
 * every write relay. It is the «just in case» action: you do not need a new
 * episode to notice that the card edited yesterday sits on a single relay, and
 * from «Events» the link is easy to miss.
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

/** The data that are in the card but not in the feed: the service does not read them yet. */
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
 * How long the service keeps a copy of the feed (`max-age`), in seconds.
 *
 * It matters when reading the outcome: an episode just published, or a relay
 * that was slow at the moment the service built the feed, stay out for the
 * whole life of the copy. It is not a fault and republishing does not remedy
 * it: you wait.
 */
const copiaServizioS = ref<number | null>(null)

async function verifica(): Promise<void> {
  if (!url.value) return
  verificaInCorso.value = true
  errore.value = null
  riassunto.value = null
  try {
    // The episodes and the card from the relays first, so the comparison is ready together with the feed.
    await Promise.all([
      pubblicati.eventi.value.length ? Promise.resolve() : pubblicati.carica(),
      leggiScheda(),
    ])
    // `no-store`: the browser would keep the copy for `max-age` and «Check»
    // after a publication would show the earlier feed. The service's copy
    // stays, though, and that is said.
    const risposta = await chiama(url.value, {
      headers: { accept: 'application/rss+xml' },
      cache: 'no-store',
    })
    if (risposta.status === 404) {
      // The service tells «no card» from «endpoint absent»: the body says so,
      // and it is worth repeating.
      let dettaglio = ''
      try {
        dettaglio = ((await risposta.json()) as { detail?: string }).detail ?? ''
      } catch {
        // a non-JSON body: the feed domain is probably not deployed
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
    // Clipboard denied: the URL is selectable in the field all the same.
  }
}

/**
 * The OPML: the feed packaged as a subscription.
 *
 * The title is **always** the one read from the feed: when it has not been
 * checked, it is checked first. A generic title here is not harmless —
 * Fountain looks every entry of the OPML up in its own catalogue *by title*,
 * and an OPML with «Podcast» had people subscribe to 127 shows by that name.
 * It happened.
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
            <code>doc/api-to-build.md</code>
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
