<script setup lang="ts">
import {
  CATEGORIE_APPLE,
  MAX_CATEGORIE,
  PIATTAFORME,
  getKindDefinition,
  parsePublicKeyInput,
  toNpub,
  type CategoriaPodcast,
  type Firmatario,
} from '@nmc/nostr-core'
import { useDeleghe } from '~/stores/deleghe'

useHead({ title: 'Profilo · NostrMediaClient' })

const identita = useIdentity()
const bozza = useEventDraft()
const esistente = useEventoEsistente()

const nome = ref('')
const nomeVisualizzato = ref('')
const descrizione = ref('')
const immagine = ref('')
const copertina = ref('')
const sito = ref('')
const nip05 = ref('')
const lud16 = ref('')
const bot = ref(false)

/** Vero quando si e' partiti da un profilo gia' pubblicato. */
const daPubblicato = ref(false)

/*
 * Cio' che nel profilo pubblicato non ha un campo qui.
 *
 * Il kind 0 e' un JSON libero e i client ci scrivono quello che vogliono —
 * `pronouns`, `birthday`, estensioni proprie. Il profilo e' sostituibile:
 * salvarlo da questa pagina riscrive tutto, e senza tenerli da parte quei
 * campi sparirebbero al primo salvataggio. Non si mostrano modificabili
 * perche' un valore puo' essere un oggetto, non una riga di testo: si
 * elencano e si ripubblicano com'erano.
 */
const campiEstranei = ref<Record<string, unknown>>({})
const nomiCampiEstranei = computed(() => Object.keys(campiEstranei.value))

/** I tag del profilo: il kind 0 non ne scrive, quindi tutto cio' che c'era resta. */
const nomiDelFormProfilo = ['client']
const conservatiProfilo = useTagConservati(nomiDelFormProfilo)
const tagExtraProfilo = conservatiProfilo.tags

/**
 * Il profilo e' **replaceable**: esiste una sola versione per pubkey, e
 * ripubblicarlo sostituisce quella precedente per intero.
 *
 * Da qui la conseguenza che rende obbligatorio caricare prima: un campo
 * lasciato vuoto non resta com'era, **sparisce**. Pubblicare un profilo
 * composto da zero cancellerebbe tutto quello che c'e' gia'.
 */
async function carica(): Promise<void> {
  const trovato = await esistente.perCoordinata(0)
  if (!trovato) return

  const definizione = getKindDefinition(0)
  if (!definizione) return

  try {
    const dati = definizione.parse(trovato)
    nome.value = dati.name ?? ''
    nomeVisualizzato.value = dati.display_name ?? ''
    descrizione.value = dati.about ?? ''
    immagine.value = dati.picture ?? ''
    copertina.value = dati.banner ?? ''
    sito.value = dati.website ?? ''
    nip05.value = dati.nip05 ?? ''
    lud16.value = dati.lud16 ?? ''
    bot.value = dati.bot === true
    // Tutto quello che non ha un campo in questa pagina: si conserva e si
    // riscrive identico, senza provare a interpretarlo.
    const noti = new Set([
      'name',
      'display_name',
      'about',
      'picture',
      'banner',
      'website',
      'nip05',
      'lud16',
      'lud06',
      'bot',
    ])
    campiEstranei.value = Object.fromEntries(
      Object.entries(dati as Record<string, unknown>).filter(([k]) => !noti.has(k)),
    )
    conservatiProfilo.fotografa(definizione, trovato, dati)
    daPubblicato.value = true
  } catch (e) {
    esistente.errore.value = `Il profilo pubblicato non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

onMounted(() => {
  if (identita.pubkey) {
    void carica()
    void caricaPodcast()
    void caricaAutore()
  }
})
watch(
  () => identita.pubkey,
  () => identita.pubkey && carica(),
)

function componi(): void {
  const definizione = getKindDefinition(0)
  if (!definizione) {
    bozza.errore.value = 'Kind 0 non registrato.'
    return
  }

  // I campi vuoti non vengono scritti: la definizione li scarta, e un campo
  // presente ma vuoto verrebbe letto come "impostato a niente".
  bozza.costruisci(
    definizione,
    {
      // Prima i campi altrui: quelli qui sotto hanno la precedenza se per caso
      // un client ha usato lo stesso nome con un valore diverso.
      ...campiEstranei.value,
      name: nome.value.trim() || undefined,
      display_name: nomeVisualizzato.value.trim() || undefined,
      about: descrizione.value.trim() || undefined,
      picture: immagine.value.trim() || undefined,
      banner: copertina.value.trim() || undefined,
      website: sito.value.trim() || undefined,
      nip05: nip05.value.trim() || undefined,
      lud16: lud16.value.trim() || undefined,
      bot: bot.value || undefined,
    },
    { aggiuntivi: tagExtraProfilo.value },
  )
}

// ─── Podcast di cui sono autore (NIP-F4, kind 10064) ──────────────────────
/*
 * L'altra meta' del cerchio. La scheda del podcast dice chi sono gli autori,
 * ma «un podcast puo' attribuirsi chiunque»: e' l'autore, dalla sua chiave,
 * a confermare. Facoltativo e chiuso di default: serve solo a chi lavora per
 * un podcast che non e' la propria identita' — per esempio con una delega.
 */
const bozzaAutore = useEventDraft()
const autoreEsistente = useEventoEsistente()
/** Il 10064 scrive solo `p`: qualunque altra cosa ci fosse resta. */
const nomiDelFormAutore = ['p', 'client']
const conservatiAutore = useTagConservati(nomiDelFormAutore)
const tagExtraAutore = conservatiAutore.tags
const podcastDiCuiSonoAutore = ref<string[]>([])
const nuovoPodcast = ref('')
const erroreAutore = ref<string | null>(null)
const mostraAutore = ref(false)
const rotta = useRoute()

async function caricaAutore(): Promise<void> {
  const trovato = await autoreEsistente.perCoordinata(10064)
  if (!trovato) return
  const definizione = getKindDefinition(10064)
  if (!definizione) return
  try {
    podcastDiCuiSonoAutore.value = definizione.parse(trovato).podcasts
    conservatiAutore.fotografa(definizione, trovato, { podcasts: podcastDiCuiSonoAutore.value })
    mostraAutore.value = podcastDiCuiSonoAutore.value.length > 0
  } catch {
    // Lista malformata: si riparte da vuoto invece di bloccare il profilo.
  }
}

function aggiungiPodcast(): void {
  erroreAutore.value = null
  try {
    const hex = parsePublicKeyInput(nuovoPodcast.value.trim())
    if (!podcastDiCuiSonoAutore.value.includes(hex)) {
      podcastDiCuiSonoAutore.value = [...podcastDiCuiSonoAutore.value, hex]
    }
    nuovoPodcast.value = ''
  } catch (e) {
    erroreAutore.value = e instanceof Error ? e.message : String(e)
  }
}

function togliPodcast(hex: string): void {
  podcastDiCuiSonoAutore.value = podcastDiCuiSonoAutore.value.filter((p) => p !== hex)
}

function componiAutore(): void {
  const definizione = getKindDefinition(10064)
  if (!definizione) {
    bozzaAutore.errore.value = 'Kind 10064 non registrato.'
    return
  }
  bozzaAutore.costruisci(
    definizione,
    { podcasts: podcastDiCuiSonoAutore.value },
    { aggiuntivi: tagExtraAutore.value },
  )
}

// Arrivando da una delega appena collegata (`?autore-di=<npub>`), la chiave
// del podcast e' gia' nel campo e la sezione e' aperta: il rimando ha senso
// solo se non costringe a ricopiare.
onMounted(() => {
  const suggerito = rotta.query['autore-di']
  if (typeof suggerito === 'string' && suggerito) {
    nuovoPodcast.value = suggerito
    mostraAutore.value = true
  }
})

// ─── Podcast (NIP-F4) ──────────────────────────────────────────────────────
/*
 * Sta qui e non nella sezione media perche' NIP-F4 modella ogni podcast come
 * una *chiave a se'*: la scheda dello show appartiene all'identita', non a un
 * singolo episodio. I lettori di podcast leggono questa e possono ignorare del
 * tutto il kind 0.
 */
const bozzaPodcast = useEventDraft()
const podcastEsistente = useEventoEsistente()
/** I tag della scheda del podcast che questo form non scrive. */
const nomiDelFormPodcast = [
  'title',
  'description',
  'image',
  'website',
  'category',
  'language',
  'email',
  'content-warning',
  'p',
  'client',
]
const conservatiPodcast = useTagConservati(nomiDelFormPodcast)
const tagExtraPodcast = conservatiPodcast.tags
/*
 * La scheda si ridistribuisce da qui, non solo da «Eventi»: e' il posto dove
 * la si modifica, ed e' dopo una modifica che ci si accorge che sta su un
 * relay solo. Si manda la versione piu' recente che questa pagina conosce —
 * quella appena pubblicata, se c'e', altrimenti quella letta dai relay.
 */
const ridistribuzionePodcast = useRidistribuzione()
const schedaDaRidistribuire = computed(() =>
  bozzaPodcast.pubblicato.value && bozzaPodcast.firmato.value
    ? bozzaPodcast.firmato.value
    : podcastEsistente.evento.value,
)
async function ridistribuisciPodcast(): Promise<void> {
  const evento = schedaDaRidistribuire.value
  if (!evento) return
  await ridistribuzionePodcast.ridistribuisci([{ evento, etichetta: 'Scheda del podcast' }])
}

const podcastTitolo = ref('')
const podcastDescrizione = ref('')
const podcastImmagine = ref('')
/**
 * I siti dello show: il primo e' il `<link>` del feed, gli altri sono i link
 * dello show sulle piattaforme (Apple, Spotify…). NIP-F4 ammette piu'
 * `website`, quindi non serve un tag apposta: si riconoscono dal dominio.
 */
const podcastSiti = ref<string[]>([])
const nuovoSito = ref('')
const haPodcast = ref(false)
const mostraPodcast = ref(false)

/*
 * Oltre NIP-F4: cio' che le piattaforme pretendono nel feed.
 *
 * Categoria (Apple, Amazon), lingua, email per la verifica della proprieta'
 * (Spotify, Amazon, YouTube), explicit. NIP-F4 non li prevede; stanno nel
 * 10154 con tag semplici che il servizio del feed sa leggere.
 */
const podcastCategorie = ref<CategoriaPodcast[]>([])
const nuovaPrincipale = ref('')
const nuovaSotto = ref('')
const podcastLingua = ref('it')
const podcastEmail = ref('')
const podcastEsplicito = ref(false)

const principaliApple = Object.keys(CATEGORIE_APPLE).map((c) => ({ value: c, label: c }))
const sottoDisponibili = computed(() =>
  (CATEGORIE_APPLE[nuovaPrincipale.value] ?? []).map((c) => ({ value: c, label: c })),
)
watch(nuovaPrincipale, () => (nuovaSotto.value = ''))

function aggiungiCategoria(): void {
  if (!nuovaPrincipale.value || podcastCategorie.value.length >= MAX_CATEGORIE) return
  const c: CategoriaPodcast = {
    principale: nuovaPrincipale.value,
    ...(nuovaSotto.value ? { sotto: nuovaSotto.value } : {}),
  }
  const stessa = (x: CategoriaPodcast) => x.principale === c.principale && x.sotto === c.sotto
  if (!podcastCategorie.value.some(stessa)) podcastCategorie.value = [...podcastCategorie.value, c]
  nuovaPrincipale.value = ''
  nuovaSotto.value = ''
}

function togliCategoria(i: number): void {
  podcastCategorie.value = podcastCategorie.value.filter((_, k) => k !== i)
}

const etichettaCategoria = (c: CategoriaPodcast): string =>
  c.sotto ? `${c.principale} › ${c.sotto}` : c.principale

/** Il nome della piattaforma a cui un sito appartiene, dal dominio; altrimenti «sito». */
function etichettaSito(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const p = PIATTAFORME.find((x) =>
      x.dominiShow.some((d) => host === d || host.endsWith(`.${d}`)),
    )
    return p ? p.nome : 'sito'
  } catch {
    return 'sito'
  }
}

function aggiungiSito(): void {
  const s = nuovoSito.value.trim()
  if (!s) return
  const url = conSchema(s)
  if (!podcastSiti.value.includes(url)) podcastSiti.value = [...podcastSiti.value, url]
  nuovoSito.value = ''
}

function togliSito(url: string): void {
  podcastSiti.value = podcastSiti.value.filter((x) => x !== url)
}

/**
 * Gli autori dichiarati dalla scheda, con il ruolo (`host`, `cohost`,
 * `editor`). E' la meta' del riscontro che sta dal lato del podcast: l'altra
 * e' il kind 10064 pubblicato da ciascun autore sulla propria chiave.
 */
const podcastAutori = ref<{ pubkey: string; role: string }[]>([])
const nuovoAutore = ref('')
const nuovoRuolo = ref('host')
const erroreAutorePodcast = ref<string | null>(null)
const ruoli = [
  { value: 'host', label: 'host' },
  { value: 'cohost', label: 'cohost' },
  { value: 'editor', label: 'editor' },
]

function aggiungiAutorePodcast(): void {
  erroreAutorePodcast.value = null
  try {
    const hex = parsePublicKeyInput(nuovoAutore.value.trim())
    podcastAutori.value = [
      ...podcastAutori.value.filter((a) => a.pubkey !== hex),
      { pubkey: hex, role: nuovoRuolo.value },
    ]
    nuovoAutore.value = ''
  } catch (e) {
    erroreAutorePodcast.value = e instanceof Error ? e.message : String(e)
  }
}

function togliAutorePodcast(hex: string): void {
  podcastAutori.value = podcastAutori.value.filter((a) => a.pubkey !== hex)
}

/*
 * Chi firma la scheda.
 *
 * La scheda sta sulla chiave del podcast. Se quella chiave e' un'altra —
 * un banco aperto in un'altra sessione — si sceglie qui la delega, e la
 * scheda che si modifica e' la *sua*, non la propria: per questo cambiando
 * firmatario si ricarica il form dalla chiave giusta.
 */
const deleghe = useDeleghe()
const firmaPodcastCon = ref('')
onMounted(() => deleghe.carica())
const delegaPodcast = computed(() =>
  firmaPodcastCon.value
    ? deleghe.elenco.find((d) => d.pubkey === firmaPodcastCon.value)
    : undefined,
)
const scelteFirmaPodcast = computed(() => [
  { value: '', label: 'La mia chiave' },
  ...deleghe.elenco.map((d) => ({ value: d.pubkey, label: d.etichetta })),
])
const firmatarioPodcast = computed<Firmatario | undefined>(() => {
  const pubkey = firmaPodcastCon.value
  if (!pubkey) return undefined
  return {
    pubkey: () => Promise.resolve(pubkey),
    firma: (template) => deleghe.firma(pubkey, template),
  }
})

watch(firmaPodcastCon, () => {
  bozzaPodcast.firmato.value = null
  bozzaPodcast.template.value = null
  void caricaPodcast()
})

function svuotaPodcast(): void {
  podcastTitolo.value = ''
  podcastDescrizione.value = ''
  podcastImmagine.value = ''
  podcastSiti.value = []
  podcastAutori.value = []
  podcastCategorie.value = []
  podcastLingua.value = 'it'
  podcastEmail.value = ''
  podcastEsplicito.value = false
  conservatiPodcast.azzera()
  haPodcast.value = false
}

async function caricaPodcast(): Promise<void> {
  svuotaPodcast()
  const trovato = await podcastEsistente.perCoordinata(
    10154,
    undefined,
    firmaPodcastCon.value || undefined,
  )
  if (!trovato) return
  const definizione = getKindDefinition(10154)
  if (!definizione) return
  try {
    const dati = definizione.parse(trovato)
    podcastTitolo.value = dati.title
    podcastDescrizione.value = dati.description ?? ''
    podcastImmagine.value = dati.image ?? ''
    podcastSiti.value = [...dati.websites]
    podcastAutori.value = dati.authors.map((a: { pubkey: string; role?: string }) => ({
      pubkey: a.pubkey,
      role: a.role ?? 'host',
    }))
    podcastCategorie.value = dati.categories.map((c: CategoriaPodcast) => ({
      principale: c.principale,
      ...(c.sotto ? { sotto: c.sotto } : {}),
    }))
    podcastLingua.value = dati.language ?? 'it'
    podcastEmail.value = dati.email ?? ''
    podcastEsplicito.value = dati.contentWarning !== undefined
    conservatiPodcast.fotografa(definizione, trovato, {
      title: dati.title,
      description: dati.description ?? '',
      image: dati.image ?? '',
      ...(podcastSiti.value.length ? { websites: podcastSiti.value } : {}),
      ...(podcastAutori.value.length ? { authors: podcastAutori.value } : {}),
      ...(podcastCategorie.value.length ? { categories: podcastCategorie.value } : {}),
      ...(dati.language ? { language: dati.language } : {}),
      ...(dati.email ? { email: dati.email } : {}),
      ...(dati.contentWarning !== undefined ? { contentWarning: dati.contentWarning } : {}),
    })
    haPodcast.value = true
    mostraPodcast.value = true
  } catch {
    // Scheda malformata: si lascia il form vuoto invece di bloccare il profilo.
  }
}

function componiPodcast(): void {
  const definizione = getKindDefinition(10154)
  if (!definizione) {
    bozzaPodcast.errore.value = 'Kind 10154 non registrato.'
    return
  }
  // Descrizione e immagine le vuole NIP-F4: la `build` le rifiuta vuote, e il
  // form le chiede prima invece di lasciar arrivare l'errore.
  bozzaPodcast.costruisci(
    definizione,
    {
      title: podcastTitolo.value.trim(),
      description: podcastDescrizione.value.trim(),
      image: podcastImmagine.value.trim(),
      ...(podcastSiti.value.length ? { websites: podcastSiti.value } : {}),
      ...(podcastAutori.value.length ? { authors: podcastAutori.value } : {}),
      ...(podcastCategorie.value.length ? { categories: podcastCategorie.value } : {}),
      ...(podcastLingua.value.trim() ? { language: podcastLingua.value.trim() } : {}),
      ...(podcastEmail.value.trim() ? { email: podcastEmail.value.trim() } : {}),
      ...(podcastEsplicito.value ? { contentWarning: '' } : {}),
    },
    { aggiuntivi: tagExtraPodcast.value },
  )
}

/**
 * Un sito scritto senza schema — «tbc159.github.io/…» — finisce nel feed RSS
 * come `<link>`, e i validatori lo rifiutano perche' non e' un URL. Meglio
 * completarlo qui che scoprirlo su Podcast Index.
 */
const conSchema = (sito: string): string => {
  const s = sito.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
}

const podcastCompleto = computed(
  () =>
    podcastTitolo.value.trim() !== '' &&
    podcastDescrizione.value.trim() !== '' &&
    podcastImmagine.value.trim() !== '',
)

const campi = [
  { modello: 'nome', label: 'Nome breve', hint: 'Senza spazi, come uno username.' },
  { modello: 'nomeVisualizzato', label: 'Nome visualizzato', hint: 'Come vuoi comparire.' },
  { modello: 'immagine', label: 'Immagine', hint: 'URL. Puoi caricarla dalla sezione media.' },
  { modello: 'copertina', label: 'Copertina', hint: 'URL dell’immagine di sfondo.' },
  { modello: 'sito', label: 'Sito', hint: '' },
  { modello: 'nip05', label: 'Identificatore NIP-05', hint: 'Nella forma nome@dominio.tld.' },
  { modello: 'lud16', label: 'Indirizzo Lightning', hint: 'Per ricevere zap.' },
] as const

const valori = { nome, nomeVisualizzato, immagine, copertina, sito, nip05, lud16 }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Il tuo profilo</h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 0 — sostituibile.</p>
      </div>
      <BaseButton to="/" variant="fantasma">← Torna agli eventi</BaseButton>
    </div>

    <ClientOnly>
      <SenzaIdentita v-if="!identita.autenticato" cosa="il profilo" />

      <template v-else>
        <div
          v-if="esistente.caricamento.value"
          class="superficie h-16 animate-pulse rounded-xl border"
        />
        <BaseAlert v-if="esistente.errore.value" tono="avviso">
          {{ esistente.errore.value }}
        </BaseAlert>

        <BaseAlert tono="avviso">
          Il profilo sostituisce per intero la versione precedente: un campo lasciato vuoto
          <strong>non resta com’era, sparisce</strong>
          .
          <template v-if="!daPubblicato">
            Qui non è stato caricato nulla dai relay, quindi pubblicando ora sovrascriveresti un
            eventuale profilo esistente con questi soli campi.
          </template>
        </BaseAlert>

        <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
          {{ identita.motivoNonFirmabile }}
          <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
          .
        </BaseAlert>

        <BaseCard>
          <form class="flex flex-col gap-4" @submit.prevent="componi">
            <BaseField
              v-for="c in campi"
              :key="c.modello"
              v-slot="{ id, describedBy }"
              :label="c.label"
              :hint="c.hint || undefined"
            >
              <BaseInput :id="id" v-model="valori[c.modello].value" :described-by="describedBy" />
            </BaseField>

            <BaseField v-slot="{ id, describedBy }" label="Descrizione">
              <BaseTextarea :id="id" v-model="descrizione" :rows="4" :described-by="describedBy" />
            </BaseField>

            <label class="flex items-center gap-2 text-sm">
              <input v-model="bot" type="checkbox" />
              Dichiara che questo account è un bot
            </label>

            <EventTagAggiuntivi
              v-model="tagExtraProfilo"
              :nomi-del-form="nomiDelFormProfilo"
              :da-evento-esistente="daPubblicato"
            />

            <!--
              I campi JSON di altri client non si modificano da qui: un valore
              puo' essere un oggetto, e un editor JSON in mezzo al profilo
              sarebbe un invito a romperlo. Si dice che ci sono e che
              restano — che e' cio' che conta sapere.
            -->
            <p v-if="nomiCampiEstranei.length" class="text-xs text-[var(--testo-tenue)]">
              Nel profilo pubblicato ci sono anche
              <template v-for="(c, i) in nomiCampiEstranei" :key="c">
                <template v-if="i > 0">,</template>
                <code>{{ c }}</code>
              </template>
              : campi scritti da un altro client, che questa pagina non mostra ma
              <strong>conserva</strong>
              così come sono.
            </p>

            <div class="flex flex-wrap gap-2">
              <BaseButton type="submit" variant="primario">Componi evento</BaseButton>
              <BaseButton
                v-if="bozza.template.value && !bozza.pubblicato.value"
                variant="primario"
                :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
                :disabled="!identita.puoFirmare"
                @click="bozza.firmaEPubblica()"
              >
                {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
              </BaseButton>
              <BaseButton variant="fantasma" :loading="esistente.caricamento.value" @click="carica">
                Ricarica dai relay
              </BaseButton>
            </div>

            <PublishProgress :invio="bozza.invio" />

            <BaseAlert v-if="bozza.errore.value" tono="pericolo">
              {{ bozza.errore.value }}
            </BaseAlert>
          </form>
        </BaseCard>

        <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
          <PublishResult :esito="bozza.invio.esito.value" />
        </BaseCard>

        <!-- ─────────── Podcast (NIP-F4) ─────────── -->
        <BaseCard
          title="Podcast"
          subtitle="Kind 10154. Serve solo se pubblichi episodi: i lettori di podcast leggono questa scheda e ignorano il profilo."
        >
          <details
            :open="mostraPodcast"
            @toggle="mostraPodcast = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="cursor-pointer text-sm">
              {{
                haPodcast
                  ? 'Modifica la scheda del podcast'
                  : 'Dichiara un podcast su questa chiave'
              }}
            </summary>

            <form class="mt-4 flex flex-col gap-4" @submit.prevent="componiPodcast">
              <BaseAlert tono="avviso">
                Per NIP-F4
                <strong>il podcast è la chiave stessa</strong>
                : questa scheda dice che
                <em>questa identità</em>
                è un podcast. Se preferisci tenerlo separato dalla tua identità personale, crea una
                chiave dedicata e usa quella.
              </BaseAlert>

              <BaseField v-slot="{ id, describedBy }" label="Titolo del podcast" required>
                <BaseInput :id="id" v-model="podcastTitolo" :described-by="describedBy" />
              </BaseField>

              <BaseField
                v-slot="{ id, describedBy }"
                label="Descrizione"
                required
                hint="Obbligatoria per NIP-F4: è quella che i lettori mostrano nell’elenco degli show."
              >
                <BaseTextarea
                  :id="id"
                  v-model="podcastDescrizione"
                  :rows="3"
                  :described-by="describedBy"
                />
              </BaseField>

              <MediaCopertinaQuadrata
                v-model="podcastImmagine"
                label="Copertina"
                required
                hint="Obbligatoria per NIP-F4. Le piattaforme la vogliono quadrata, da 1400 a 3000 px: «Carica» e «Ritaglia» la sistemano."
              />

              <!-- ── Categoria, lingua, explicit ── -->
              <div class="flex flex-col gap-2">
                <p class="text-sm font-medium">
                  Categoria
                  <span class="font-normal text-[var(--testo-tenue)]">
                    — Apple e Amazon la pretendono; fino a {{ MAX_CATEGORIE }}, la prima è la
                    principale
                  </span>
                </p>
                <ul v-if="podcastCategorie.length" class="flex flex-wrap gap-2 text-sm">
                  <li
                    v-for="(c, i) in podcastCategorie"
                    :key="etichettaCategoria(c)"
                    class="superficie flex items-center gap-2 rounded-md border px-3 py-1"
                  >
                    <span>{{ etichettaCategoria(c) }}</span>
                    <BaseBadge v-if="i === 0">principale</BaseBadge>
                    <button
                      type="button"
                      class="text-xs underline"
                      :aria-label="`Togli ${etichettaCategoria(c)}`"
                      @click="togliCategoria(i)"
                    >
                      togli
                    </button>
                  </li>
                </ul>
                <div
                  v-if="podcastCategorie.length < MAX_CATEGORIE"
                  class="flex flex-wrap items-end gap-2"
                >
                  <BaseField v-slot="{ id }" label="Categoria Apple">
                    <BaseSelect
                      :id="id"
                      v-model="nuovaPrincipale"
                      :options="[{ value: '', label: '— scegli —' }, ...principaliApple]"
                    />
                  </BaseField>
                  <BaseField v-if="sottoDisponibili.length" v-slot="{ id }" label="Sotto-categoria">
                    <BaseSelect
                      :id="id"
                      v-model="nuovaSotto"
                      :options="[{ value: '', label: '— nessuna —' }, ...sottoDisponibili]"
                    />
                  </BaseField>
                  <BaseButton :disabled="!nuovaPrincipale" @click="aggiungiCategoria">
                    Aggiungi
                  </BaseButton>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <BaseField
                  v-slot="{ id, describedBy }"
                  label="Lingua"
                  hint="Codice ISO 639-1: it, en, es… Va nel feed come <language>."
                >
                  <BaseInput
                    :id="id"
                    v-model="podcastLingua"
                    placeholder="it"
                    :described-by="describedBy"
                  />
                </BaseField>
                <BaseField
                  v-slot="{ id, describedBy }"
                  label="Email per le piattaforme"
                  hint="Spotify, Amazon e YouTube mandano lì la verifica di proprietà. È pubblica: finisce nel feed e su Nostr."
                >
                  <BaseInput
                    :id="id"
                    v-model="podcastEmail"
                    type="email"
                    placeholder="podcast@esempio.tld"
                    :described-by="describedBy"
                  />
                </BaseField>
              </div>

              <label class="flex items-start gap-2 text-sm">
                <input v-model="podcastEsplicito" type="checkbox" class="mt-1" />
                <span>
                  Contenuti espliciti
                  <span class="block text-xs text-[var(--testo-tenue)]">
                    Diventa
                    <code>itunes:explicit</code>
                    nel feed e un tag
                    <code>content-warning</code>
                    (NIP-36) nella scheda. Apple lo chiede sempre, anche per dire di no.
                  </span>
                </span>
              </label>

              <!-- ── Siti ── -->
              <div class="flex flex-col gap-2">
                <p class="text-sm font-medium">Siti</p>
                <p class="text-xs text-[var(--testo-tenue)]">
                  Il primo è il sito del podcast, quello che il feed usa come link. Gli altri sono i
                  link dello show sulle piattaforme, una volta accettato: si riconoscono da soli.
                </p>
                <ul v-if="podcastSiti.length" class="flex flex-col gap-1 text-sm">
                  <li
                    v-for="s in podcastSiti"
                    :key="s"
                    class="superficie flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <BaseBadge>{{ etichettaSito(s) }}</BaseBadge>
                    <code class="min-w-0 flex-1 truncate text-xs">{{ s }}</code>
                    <BaseButton size="sm" variant="fantasma" @click="togliSito(s)">
                      Togli
                    </BaseButton>
                  </li>
                </ul>
                <div class="flex flex-wrap items-end gap-2">
                  <div class="min-w-64 flex-1">
                    <BaseField v-slot="{ id, describedBy }" label="Aggiungi un sito">
                      <BaseInput
                        :id="id"
                        v-model="nuovoSito"
                        placeholder="https://… oppure podcasts.apple.com/…"
                        :described-by="describedBy"
                        @keydown.enter.prevent="aggiungiSito"
                      />
                    </BaseField>
                  </div>
                  <BaseButton :disabled="!nuovoSito.trim()" @click="aggiungiSito">
                    Aggiungi
                  </BaseButton>
                </div>
              </div>

              <!-- ── Autori ── -->
              <div class="flex flex-col gap-2">
                <p class="text-sm font-medium">Autori</p>
                <p class="text-xs text-[var(--testo-tenue)]">
                  Chi lavora al podcast, con il ruolo. È la metà del riscontro dal lato dello show:
                  ciascuno conferma dalla propria chiave con «Podcast di cui sono autore».
                </p>
                <ul v-if="podcastAutori.length" class="flex flex-col gap-1 text-sm">
                  <li
                    v-for="a in podcastAutori"
                    :key="a.pubkey"
                    class="superficie flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <code class="min-w-0 flex-1 truncate text-xs">{{ toNpub(a.pubkey) }}</code>
                    <BaseBadge>{{ a.role }}</BaseBadge>
                    <BaseButton size="sm" variant="fantasma" @click="togliAutorePodcast(a.pubkey)">
                      Togli
                    </BaseButton>
                  </li>
                </ul>
                <div class="flex flex-wrap items-end gap-2">
                  <div class="min-w-64 flex-1">
                    <BaseField
                      v-slot="{ id, describedBy }"
                      label="Chiave dell’autore"
                      hint="npub o esadecimale."
                    >
                      <BaseInput
                        :id="id"
                        v-model="nuovoAutore"
                        placeholder="npub1…"
                        :described-by="describedBy"
                      />
                    </BaseField>
                  </div>
                  <BaseField v-slot="{ id }" label="Ruolo">
                    <BaseSelect :id="id" v-model="nuovoRuolo" :options="ruoli" />
                  </BaseField>
                  <BaseButton :disabled="!nuovoAutore.trim()" @click="aggiungiAutorePodcast">
                    Aggiungi
                  </BaseButton>
                </div>
                <BaseAlert v-if="erroreAutorePodcast" tono="pericolo">
                  {{ erroreAutorePodcast }}
                </BaseAlert>
              </div>

              <!-- ── Chi firma ── -->
              <BaseField
                v-if="deleghe.elenco.length"
                v-slot="{ id }"
                label="Chi firma"
                hint="La scheda sta sulla chiave del podcast. Con una delega la firma chi tiene quella chiave, e il form mostra la sua scheda, non la tua."
              >
                <BaseSelect :id="id" v-model="firmaPodcastCon" :options="scelteFirmaPodcast" />
              </BaseField>
              <BaseAlert v-if="delegaPodcast" tono="avviso">
                La scheda risulterà pubblicata da
                <strong>{{ delegaPodcast.etichetta }}</strong>
                : sostituisce la sua, non la tua. Dall’altra parte qualcuno deve approvarla.
              </BaseAlert>

              <EventTagAggiuntivi
                v-model="tagExtraPodcast"
                :nomi-del-form="nomiDelFormPodcast"
                :da-evento-esistente="haPodcast"
              />

              <div class="flex flex-wrap gap-2">
                <BaseButton type="submit" variant="primario" :disabled="!podcastCompleto">
                  Componi evento
                </BaseButton>
                <BaseButton
                  v-if="bozzaPodcast.template.value && !bozzaPodcast.pubblicato.value"
                  variant="primario"
                  :loading="bozzaPodcast.inCorso.value || bozzaPodcast.invio.inCorso.value"
                  :disabled="!identita.puoFirmare"
                  @click="bozzaPodcast.firmaEPubblica(firmatarioPodcast)"
                >
                  <template v-if="bozzaPodcast.firmato.value">Pubblica</template>
                  <template v-else-if="delegaPodcast">Chiedi la firma e pubblica</template>
                  <template v-else>Firma e pubblica</template>
                </BaseButton>
                <BaseButton
                  v-if="
                    schedaDaRidistribuire &&
                    !(bozzaPodcast.template.value && !bozzaPodcast.pubblicato.value)
                  "
                  variant="fantasma"
                  :loading="ridistribuzionePodcast.inCorso.value"
                  title="Manda la scheda così com’è, già firmata, a tutti i relay di scrittura: chi ce l’ha già lo dice, nessun duplicato."
                  @click="ridistribuisciPodcast"
                >
                  Ridistribuisci sui relay
                </BaseButton>
              </div>

              <p
                v-if="ridistribuzionePodcast.esiti.value.length"
                class="text-xs text-[var(--testo-tenue)]"
              >
                Scheda del podcast:
                {{ ridistribuzionePodcast.riga(ridistribuzionePodcast.esiti.value[0]!) }}.
              </p>
              <BaseAlert v-if="ridistribuzionePodcast.errore.value" tono="pericolo">
                {{ ridistribuzionePodcast.errore.value }}
              </BaseAlert>

              <PublishProgress :invio="bozzaPodcast.invio" />

              <BaseAlert v-if="bozzaPodcast.errore.value" tono="pericolo">
                {{ bozzaPodcast.errore.value }}
              </BaseAlert>

              <PublishResult
                v-if="bozzaPodcast.invio.esito.value"
                :esito="bozzaPodcast.invio.esito.value"
              />
            </form>
          </details>
        </BaseCard>

        <!--
          Il feed sta qui e non fra i media: e' la scheda del podcast vista da
          fuori Nostr, e si verifica subito dopo averla modificata.
        -->
        <MediaFeedRss />

        <!-- ─────────── Podcast di cui sono autore (NIP-F4) ─────────── -->
        <BaseCard
          title="Podcast di cui sono autore"
          subtitle="Kind 10064, facoltativo. Per chi lavora a un podcast che è un’altra chiave: la scheda del podcast può nominarti, ma sei tu a confermare."
        >
          <details
            :open="mostraAutore"
            @toggle="mostraAutore = ($event.target as HTMLDetailsElement).open"
          >
            <summary class="cursor-pointer text-sm">
              {{
                podcastDiCuiSonoAutore.length
                  ? `Sei autore di ${podcastDiCuiSonoAutore.length} podcast`
                  : 'Dichiara i podcast di cui sei autore'
              }}
            </summary>

            <form class="mt-4 flex flex-col gap-4" @submit.prevent="componiAutore">
              <BaseAlert tono="info">
                Ha senso solo se il podcast è
                <strong>un’altra chiave</strong>
                — per esempio una a cui chiedi la firma con una delega. Se pubblichi episodi con
                questa identità, il podcast sei già tu e questa lista non serve.
              </BaseAlert>

              <ul v-if="podcastDiCuiSonoAutore.length" class="flex flex-col gap-1 text-sm">
                <li
                  v-for="p in podcastDiCuiSonoAutore"
                  :key="p"
                  class="superficie flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <code class="min-w-0 flex-1 truncate text-xs">{{ toNpub(p) }}</code>
                  <BaseButton size="sm" variant="fantasma" @click="togliPodcast(p)">
                    Togli
                  </BaseButton>
                </li>
              </ul>

              <div class="flex flex-wrap items-end gap-2">
                <div class="min-w-64 flex-1">
                  <BaseField
                    v-slot="{ id, describedBy }"
                    label="Chiave del podcast"
                    hint="npub o esadecimale."
                  >
                    <BaseInput
                      :id="id"
                      v-model="nuovoPodcast"
                      placeholder="npub1…"
                      :described-by="describedBy"
                    />
                  </BaseField>
                </div>
                <BaseButton :disabled="!nuovoPodcast.trim()" @click="aggiungiPodcast">
                  Aggiungi
                </BaseButton>
              </div>
              <BaseAlert v-if="erroreAutore" tono="pericolo">{{ erroreAutore }}</BaseAlert>

              <EventTagAggiuntivi
                v-model="tagExtraAutore"
                :nomi-del-form="nomiDelFormAutore"
                :da-evento-esistente="podcastDiCuiSonoAutore.length > 0"
              />

              <div class="flex flex-wrap gap-2">
                <BaseButton
                  type="submit"
                  variant="primario"
                  :disabled="!podcastDiCuiSonoAutore.length"
                >
                  Componi evento
                </BaseButton>
                <BaseButton
                  v-if="bozzaAutore.template.value && !bozzaAutore.pubblicato.value"
                  variant="primario"
                  :loading="bozzaAutore.inCorso.value || bozzaAutore.invio.inCorso.value"
                  :disabled="!identita.puoFirmare"
                  @click="bozzaAutore.firmaEPubblica()"
                >
                  {{ bozzaAutore.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
                </BaseButton>
              </div>

              <PublishProgress :invio="bozzaAutore.invio" />
              <BaseAlert v-if="bozzaAutore.errore.value" tono="pericolo">
                {{ bozzaAutore.errore.value }}
              </BaseAlert>
              <PublishResult
                v-if="bozzaAutore.invio.esito.value"
                :esito="bozzaAutore.invio.esito.value"
              />
            </form>
          </details>
        </BaseCard>

        <BaseCard v-if="bozza.template.value" title="Evento">
          <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
        </BaseCard>
      </template>
    </ClientOnly>
  </div>
</template>
