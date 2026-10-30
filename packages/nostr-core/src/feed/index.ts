import { npubEncode } from 'nostr-tools/nip19'

import { normalizzaBaseUrl } from '../services/http.js'
import { podcastGuidPerUrl } from '../utils/uuid.js'

export * from './indirizzo.js'

/**
 * The podcast's RSS feed: the client does not generate it, it governs it.
 *
 * A feed is a stable URL that podcast apps re-read by themselves; neither
 * GitHub Pages (static) nor Blossom (the address changes on every edit) can
 * serve it. The media-manager's `feed` domain serves it, without a key. Here
 * is what the client has to be able to do: compose the URL for a key, and
 * read a feed to say how it is — how many episodes, the latest one, what is
 * missing — without trusting a 200.
 *
 * The messages in the summary stay in Italian: the RSS feed card shows them.
 */

/** A key's feed URL, on the given service. */
export function urlFeedPodcast(radiceServizio: string, pubkey: string, lingua?: string): string {
  const radice = normalizzaBaseUrl(radiceServizio)
  if (radice === '') throw new Error('Indirizzo del servizio mancante.')
  const npub = /^[0-9a-f]{64}$/i.test(pubkey) ? npubEncode(pubkey.toLowerCase()) : pubkey
  const lang = lingua && lingua !== 'it' ? `?lang=${encodeURIComponent(lingua)}` : ''
  return `${radice}/v0/feed/${npub}.xml${lang}`
}

export interface EpisodioFeed {
  /** The `guid`: for our service it is the kind 54 event's id. */
  id: string | null
  titolo: string
  data: Date | null
  audioUrl: string | null
  /** The length declared in the enclosure; 0 when the service could not measure it. */
  byte: number
}

export interface RiassuntoFeed {
  titolo: string
  descrizione: string
  immagine: string | null
  lingua: string | null
  /** The primary category (`itunes:category`), when the feed declares it. */
  categoria: string | null
  /** The owner's email (`itunes:email`), when present: that is where Spotify, Amazon and YouTube verify. */
  email: string | null
  /** True when the feed declares <itunes:explicit>true</itunes:explicit>. */
  explicit: boolean
  episodi: EpisodioFeed[]
  /** The show's identity (`podcast:guid`), when the feed declares it. */
  podcastGuid: string | null
  /** `itunes:new-feed-url`: where the feed says it has moved, or itself in a new feed. */
  nuovoFeedUrl: string | null
  /** `atom:link rel="self"`: the address the feed says it lives at. */
  selfUrl: string | null
  /** The relays the service queried, when it declares them in a comment at the top. */
  relays: string[]
  /** Things a podcast app would refuse or display badly. */
  problemi: string[]
}

/*
 * Targeted reading, not an XML parser.
 *
 * The feed is produced by a service of ours from a contract written by us: we
 * extract the few tags needed to summarise it, and we stay isomorphic — the
 * browser has DOMParser, Node does not, and an XML parser as a dependency to
 * read six tags would be out of proportion. If the format changed, the
 * summary would say «no episodes» and the page would show it: a visible
 * failure, not a silent one.
 */
export const decodifica = (t: string): string =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Numeric references before &amp;, or "&amp;#39;" would turn into an apostrophe.
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .trim()

/** The text of the first `<nome>…</nome>` in the block, decoded. */
export function tagIn(blocco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i').exec(blocco)
  return m ? decodifica(m[1] ?? '') : null
}

/** An attribute of the first `<tag …>` in the block, decoded. */
export function attributo(blocco: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i').exec(blocco)
  return m ? decodifica(m[1] ?? '') : null
}

/** The `<item>` blocks, and the channel with them taken out. */
export function dividiFeed(xml: string): { canale: string; item: string[] } {
  return {
    item: [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1] ?? ''),
    canale: xml.replace(/<item\b[\s\S]*<\/item>/gi, ''),
  }
}

/** Reads an RSS feed and returns a summary of it with the problems found. */
export function riassumiFeedPodcast(xml: string): RiassuntoFeed {
  const problemi: string[] = []
  if (!/<rss\b/i.test(xml)) {
    throw new Error('Non è un feed RSS: il documento non contiene <rss>.')
  }

  const { canale, item: blocchiItem } = dividiFeed(xml)

  const titolo = tagIn(canale, 'title') ?? ''
  const descrizione = tagIn(canale, 'description') ?? ''
  const immagine =
    attributo(canale, 'itunes:image', 'href') ?? tagIn(tagIn(canale, 'image') ?? '', 'url')
  const lingua = tagIn(canale, 'language')

  if (titolo === '') problemi.push('il canale non ha un titolo')
  if (descrizione === '') problemi.push('il canale non ha una descrizione')
  if (!immagine) problemi.push('manca l’immagine del canale: Apple e Podcast Index la pretendono')
  if (!lingua) problemi.push('manca la lingua del canale')
  const explicitGrezzo = tagIn(canale, 'itunes:explicit')
  if (explicitGrezzo === null) problemi.push('manca <itunes:explicit>, obbligatorio per Apple')
  const explicit = /^(true|yes)$/i.test(explicitGrezzo ?? '')

  const categoria = attributo(canale, 'itunes:category', 'text')
  if (!categoria)
    problemi.push('manca la categoria (itunes:category): Apple e Amazon la pretendono')
  const email = tagIn(canale, 'itunes:email')
  if (!email) {
    problemi.push(
      'manca l’email dell’owner (itunes:email): Spotify, Amazon e YouTube verificano lì',
    )
  }
  // An <itunes:owner> without an email is an error for the validator: when
  // the block is there, the email has to be inside it.
  if (/<itunes:owner>/i.test(canale) && !email) {
    problemi.push(
      '<itunes:owner> senza <itunes:email>: il validatore lo rifiuta, va omesso o completato',
    )
  }

  const relays = [...xml.matchAll(/<!--\s*relays:\s*([^>]*?)-->/gi)]
    .flatMap((m) => (m[1] ?? '').split(/[\s,]+/))
    .filter((r) => r.startsWith('ws'))

  const episodi: EpisodioFeed[] = blocchiItem.map((b) => {
    const dataGrezza = tagIn(b, 'pubDate')
    const data = dataGrezza ? new Date(dataGrezza) : null
    return {
      id: tagIn(b, 'guid'),
      titolo: tagIn(b, 'title') ?? '(senza titolo)',
      data: data && !Number.isNaN(data.getTime()) ? data : null,
      audioUrl: attributo(b, 'enclosure', 'url'),
      byte: Number(attributo(b, 'enclosure', 'length') ?? 0) || 0,
    }
  })

  const senzaAudio = episodi.filter((e) => !e.audioUrl).length
  if (senzaAudio) problemi.push(`${senzaAudio} episodi senza enclosure: le app non li mostrano`)
  const senzaPeso = episodi.filter((e) => e.audioUrl && e.byte === 0).length
  if (senzaPeso) {
    problemi.push(
      `${senzaPeso} episodi con length="0": il servizio non ha potuto misurare il file, alcune app li scartano`,
    )
  }
  const saltati = /<!--\s*saltati:\s*(\d+)/i.exec(xml)
  if (saltati && Number(saltati[1]) > 0) {
    problemi.push(`${saltati[1]} episodi saltati dal servizio perché senza audio`)
  }

  const senzaDurata = episodi.length
    ? blocchiItem.filter((b) => !tagIn(b, 'itunes:duration')).length
    : 0
  if (senzaDurata) {
    problemi.push(`${senzaDurata} episodi senza itunes:duration: le app mostrano una durata vuota`)
  }

  return {
    titolo,
    descrizione,
    immagine: immagine || null,
    lingua,
    categoria,
    email,
    explicit,
    episodi,
    podcastGuid: tagIn(canale, 'podcast:guid'),
    nuovoFeedUrl: tagIn(canale, 'itunes:new-feed-url'),
    selfUrl: linkSelf(canale),
    relays,
    problemi,
  }
}

/** The `href` of the `<atom:link rel="self">`, whatever the order of its attributes. */
function linkSelf(canale: string): string | null {
  for (const m of canale.matchAll(/<atom:link\b([^>]*)>/gi)) {
    const attr = m[1] ?? ''
    if (/\brel="self"/i.test(attr)) {
      const href = /\bhref="([^"]*)"/i.exec(attr)?.[1]
      if (href) return decodifica(href)
    }
  }
  return null
}

/**
 * Compares the feed with the episodes the client sees on the relays.
 *
 * It is the diagnosis that matters: a feed with fewer episodes than were
 * published almost always means an episode sits on a relay the service does
 * not read from — and the remedy is redistributing it, not publishing it
 * again.
 */
export function episodiFuoriDalFeed(
  feed: Pick<RiassuntoFeed, 'episodi'>,
  pubblicati: readonly { id: string; titolo: string }[],
): { id: string; titolo: string }[] {
  const nelFeed = new Set(feed.episodi.map((e) => e.id).filter((id): id is string => !!id))
  return pubblicati.filter((p) => !nelFeed.has(p.id))
}

/**
 * Plain text from a fragment of HTML: paragraphs and line breaks become new
 * lines, tags go, entities are decoded, spaces collapse.
 *
 * Hosts write descriptions as HTML (Anchor wraps every one in `<p>`) while
 * NMC writes plain text: two descriptions with the same words have to compare
 * as equal. YouTube also refuses HTML in descriptions, which is the other
 * reason an import passes through here.
 */
export function testoDaHtml(html: string): string {
  return decodifica(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type GravitaDifferenza = 'blocca' | 'avviso'

export interface DifferenzaFeed {
  campo:
    | 'podcast:guid'
    | 'new-feed-url'
    | 'titolo'
    | 'descrizione'
    | 'episodio-mancante'
    | 'episodio-senza-guid'
    | 'episodio-nuovo'
    | 'ordine'
    | 'data'
  /** `blocca`: a redirect now would lose something. `avviso`: worth a look, nothing lost. */
  gravita: GravitaDifferenza
  /** What differs, in words. The UI shows it, so it stays Italian. */
  testo: string
  /** The episode it refers to, when it refers to one. */
  guid?: string
}

export interface EsitoConfronto {
  /** True when nothing blocks: the redirect from the old host keeps every episode and the show's identity. */
  sicuro: boolean
  differenze: DifferenzaFeed[]
}

const DATA_IT = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'UTC' })
const normalizza = (t: string): string => testoDaHtml(t).replace(/\s+/g, ' ').trim()

/**
 * Compares the old host's feed with NMC's, before the redirect.
 *
 * It is the check that tells whether moving loses anything. Blocking: a
 * different show identity (`podcast:guid`), and an old episode missing from the
 * new feed — the apps would drop it, or show it twice under a new GUID.
 * Warnings: titles, descriptions, dates and order that differ, episodes in the
 * new feed only, a missing `itunes:new-feed-url`.
 *
 * @param opzioni.urlVecchio the old feed's address. An old feed that declares
 *        no `podcast:guid` still has one — the one computed from its address,
 *        which is how Podcast Index knows it. The address the feed declares
 *        for itself comes first, as in the import: a copy downloaded from
 *        elsewhere is still the show at its own address.
 */
export async function confrontaFeed(
  vecchio: RiassuntoFeed,
  nuovo: RiassuntoFeed,
  opzioni: { urlVecchio?: string } = {},
): Promise<EsitoConfronto> {
  const differenze: DifferenzaFeed[] = []

  const indirizzoVecchio = vecchio.selfUrl ?? opzioni.urlVecchio
  const identitaVecchia =
    vecchio.podcastGuid ?? (indirizzoVecchio ? await podcastGuidPerUrl(indirizzoVecchio) : null)
  if (identitaVecchia && nuovo.podcastGuid !== identitaVecchia) {
    differenze.push({
      campo: 'podcast:guid',
      gravita: 'blocca',
      testo: nuovo.podcastGuid
        ? `Il nuovo feed dichiara l’identità ${nuovo.podcastGuid}, il vecchio è ${identitaVecchia}: per Podcast Index e Fountain sarebbe un altro podcast.`
        : `Il nuovo feed non dichiara un podcast:guid, il vecchio è ${identitaVecchia}: per Podcast Index e Fountain sarebbe un altro podcast.`,
    })
  }

  if (!nuovo.nuovoFeedUrl) {
    differenze.push({
      campo: 'new-feed-url',
      gravita: 'avviso',
      testo:
        'Il nuovo feed non ha <itunes:new-feed-url>: Apple lo chiede nel feed di arrivo di un trasloco.',
    })
  } else if (nuovo.selfUrl && nuovo.nuovoFeedUrl !== nuovo.selfUrl) {
    differenze.push({
      campo: 'new-feed-url',
      gravita: 'avviso',
      testo: `<itunes:new-feed-url> (${nuovo.nuovoFeedUrl}) non coincide con l’indirizzo del feed (${nuovo.selfUrl}).`,
    })
  }

  if (normalizza(vecchio.titolo) !== normalizza(nuovo.titolo)) {
    differenze.push({
      campo: 'titolo',
      gravita: 'avviso',
      testo: `Il titolo cambia: «${vecchio.titolo}» → «${nuovo.titolo}».`,
    })
  }
  if (normalizza(vecchio.descrizione) !== normalizza(nuovo.descrizione)) {
    differenze.push({
      campo: 'descrizione',
      gravita: 'avviso',
      testo: 'La descrizione dello show è diversa da quella del vecchio feed.',
    })
  }

  const nuoviPerGuid = new Map(
    nuovo.episodi.filter((e) => e.id).map((e) => [e.id as string, e] as const),
  )
  const vecchiConGuid = vecchio.episodi.filter((e) => e.id)

  for (const e of vecchio.episodi.filter((e) => !e.id)) {
    differenze.push({
      campo: 'episodio-senza-guid',
      gravita: 'avviso',
      testo: `«${e.titolo}» non ha un GUID nel vecchio feed: le app lo riconoscono dall’URL dell’audio, e non si può verificare.`,
    })
  }

  for (const e of vecchiConGuid) {
    const corrispondente = nuoviPerGuid.get(e.id as string)
    if (!corrispondente) {
      differenze.push({
        campo: 'episodio-mancante',
        gravita: 'blocca',
        testo: `«${e.titolo}» non è nel nuovo feed con lo stesso GUID: le app lo toglierebbero, o lo mostrerebbero due volte.`,
        guid: e.id as string,
      })
      continue
    }
    if (e.data && corrispondente.data && e.data.getTime() !== corrispondente.data.getTime()) {
      differenze.push({
        campo: 'data',
        gravita: 'avviso',
        testo: `«${e.titolo}»: la data passa dal ${DATA_IT.format(e.data)} al ${DATA_IT.format(corrispondente.data)}.`,
        guid: e.id as string,
      })
    }
  }

  const guidVecchi = new Set(vecchiConGuid.map((e) => e.id as string))
  for (const e of nuovo.episodi) {
    if (e.id && !guidVecchi.has(e.id)) {
      differenze.push({
        campo: 'episodio-nuovo',
        gravita: 'avviso',
        testo: `«${e.titolo}» c’è solo nel nuovo feed.`,
        guid: e.id,
      })
    }
  }

  // The order of the episodes both feeds have, compared as sequences.
  const comuni = new Set(
    vecchiConGuid.map((e) => e.id as string).filter((g) => nuoviPerGuid.has(g)),
  )
  const ordineVecchio = vecchiConGuid.map((e) => e.id as string).filter((g) => comuni.has(g))
  const ordineNuovo = nuovo.episodi
    .map((e) => e.id)
    .filter((g): g is string => !!g && comuni.has(g))
  if (ordineVecchio.join('\n') !== ordineNuovo.join('\n')) {
    differenze.push({
      campo: 'ordine',
      gravita: 'avviso',
      testo: 'Gli episodi sono in un ordine diverso rispetto al vecchio feed.',
    })
  }

  return { sicuro: !differenze.some((d) => d.gravita === 'blocca'), differenze }
}

const xmlEsc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * An OPML with the podcast's feed alone.
 *
 * It is the format podcast apps exchange subscriptions in: Fountain, Apple
 * and Overcast import it. It holds the feed's URL and the title, nothing else
 * — whoever imports it follows the podcast without searching a directory, and
 * it is the way to share it even before a directory has indexed it.
 */
export function opmlPerFeed(dati: { titolo: string; urlFeed: string; sito?: string }): string {
  const titolo = xmlEsc(dati.titolo.trim() || 'Podcast')
  const html = dati.sito ? ` htmlUrl="${xmlEsc(dati.sito)}"` : ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${titolo}</title>`,
    '  </head>',
    '  <body>',
    `    <outline type="rss" text="${titolo}" title="${titolo}" xmlUrl="${xmlEsc(dati.urlFeed)}"${html}/>`,
    '  </body>',
    '</opml>',
    '',
  ].join('\n')
}
