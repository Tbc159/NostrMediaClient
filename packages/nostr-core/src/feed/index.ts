import { npubEncode } from 'nostr-tools/nip19'

import { normalizzaBaseUrl } from '../servizi/http.js'

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
const decodifica = (t: string): string =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

function tagIn(blocco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i').exec(blocco)
  return m ? decodifica(m[1] ?? '') : null
}

function attributo(blocco: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i').exec(blocco)
  return m ? decodifica(m[1] ?? '') : null
}

/** Reads an RSS feed and returns a summary of it with the problems found. */
export function riassumiFeedPodcast(xml: string): RiassuntoFeed {
  const problemi: string[] = []
  if (!/<rss\b/i.test(xml)) {
    throw new Error('Non e’ un feed RSS: il documento non contiene <rss>.')
  }

  const blocchiItem = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1] ?? '')
  const canale = xml.replace(/<item\b[\s\S]*<\/item>/gi, '')

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
    relays,
    problemi,
  }
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
