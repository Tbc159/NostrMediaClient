import { npubEncode } from 'nostr-tools/nip19'

import { normalizzaBaseUrl } from '../servizi/http.js'

/**
 * Il feed RSS del podcast: il client non lo genera, lo governa.
 *
 * Un feed e' un URL stabile che le app di podcast rileggono da sole; ne'
 * GitHub Pages (statico) ne' Blossom (l'indirizzo cambia a ogni modifica)
 * possono servirlo. Lo serve il dominio `feed` del media-manager, senza
 * chiave. Qui c'e' cio' che il client deve saper fare: comporre l'URL per una
 * chiave, e leggere un feed per dire com'e' — quanti episodi, l'ultimo, cosa
 * manca — senza fidarsi di un 200.
 */

/** L'URL del feed di una chiave, sul servizio dato. */
export function urlFeedPodcast(radiceServizio: string, pubkey: string, lingua?: string): string {
  const radice = normalizzaBaseUrl(radiceServizio)
  if (radice === '') throw new Error('Indirizzo del servizio mancante.')
  const npub = /^[0-9a-f]{64}$/i.test(pubkey) ? npubEncode(pubkey.toLowerCase()) : pubkey
  const lang = lingua && lingua !== 'it' ? `?lang=${encodeURIComponent(lingua)}` : ''
  return `${radice}/v0/feed/${npub}.xml${lang}`
}

export interface EpisodioFeed {
  /** Il `guid`: per il nostro servizio e' l'id dell'evento kind 54. */
  id: string | null
  titolo: string
  data: Date | null
  audioUrl: string | null
  /** Lunghezza dichiarata nell'enclosure; 0 se il servizio non e' riuscito a misurarla. */
  byte: number
}

export interface RiassuntoFeed {
  titolo: string
  descrizione: string
  immagine: string | null
  lingua: string | null
  episodi: EpisodioFeed[]
  /** Relay interrogati dal servizio, se li dichiara in un commento in testa. */
  relays: string[]
  /** Cose che un'app di podcast rifiuterebbe o mostrerebbe male. */
  problemi: string[]
}

/*
 * Lettura mirata, non un parser XML.
 *
 * Il feed lo produce un servizio nostro a partire da un contratto scritto da
 * noi: si estraggono i pochi tag che servono a riassumerlo, e si resta
 * isomorfici — nel browser c'e' DOMParser, in Node no, e un parser XML come
 * dipendenza per leggere sei tag sarebbe sproporzionato. Se il formato
 * cambiasse, il riassunto direbbe «nessun episodio» e la pagina lo
 * mostrerebbe: un fallimento visibile, non silenzioso.
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

/** Legge un feed RSS e ne restituisce un riassunto con i problemi trovati. */
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
  if (!/<itunes:explicit>/i.test(canale))
    problemi.push('manca <itunes:explicit>, obbligatorio per Apple')

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

  return { titolo, descrizione, immagine: immagine || null, lingua, episodi, relays, problemi }
}

/**
 * Confronta il feed con gli episodi che il client vede sui relay.
 *
 * E' la diagnosi che conta: un feed con meno episodi di quelli pubblicati
 * significa quasi sempre che un episodio sta su un relay da cui il servizio
 * non legge — e il rimedio e' ridistribuirlo, non ripubblicarlo.
 */
export function episodiFuoriDalFeed(
  feed: Pick<RiassuntoFeed, 'episodi'>,
  pubblicati: readonly { id: string; titolo: string }[],
): { id: string; titolo: string }[] {
  const nelFeed = new Set(feed.episodi.map((e) => e.id).filter((id): id is string => !!id))
  return pubblicati.filter((p) => !nelFeed.has(p.id))
}
