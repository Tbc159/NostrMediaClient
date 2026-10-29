import { attributo, decodifica, dividiFeed, tagIn, testoDaHtml } from '../feed/index.js'
import type { DestinatarioValore, Persona, Valore } from '../kinds/podcast-extra.js'
import type { FileAllegato, TipoEpisodio, TipoPodcast } from '../kinds/definitions/podcast.js'
import { TIPI_EPISODIO } from '../kinds/definitions/podcast.js'
import { podcastGuidPerUrl } from '../utils/uuid.js'

/**
 * Reading a podcast's RSS feed from another host, to move it to NMC.
 *
 * The aim is that nothing the creator built there is lost: the identities the
 * apps know the show and its episodes by, the dates, the numbering, and the
 * Podcasting 2.0 data — above all `value`, from which the boosts depend. What
 * this module returns maps one to one onto the inputs of the kind 10154 and
 * kind 54 definitions; what it cannot carry, it lists.
 *
 * It reads with the same targeted approach as `feed/index.ts`, not with an XML
 * parser, and for the same reasons: it stays isomorphic, and the shapes are
 * few and known. The warnings stay in Italian: the import preview shows them.
 */

export interface PodcastImportato {
  titolo: string
  /** Plain text: descriptions arrive as HTML from most hosts. */
  descrizione: string
  immagine?: string
  lingua?: string
  categoria?: { principale: string; sotto?: string }
  email?: string
  autore?: string
  tipo?: TipoPodcast
  /** The channel's `<link>`: the show's site, which becomes the first `website`. */
  sito?: string
  /** The identity to inherit. */
  podcastGuid?: string
  /** True when the feed did not declare it and it was computed from its address. */
  podcastGuidCalcolato: boolean
  explicit: boolean
  valore?: Valore
  persone: Persona[]
  finanziamenti: { url: string; testo?: string }[]
}

export interface EpisodioImportato {
  /** The GUID on the old host: what the apps know the episode by. */
  guid?: string
  titolo: string
  descrizione: string
  /** The notes as the old host wrote them, to be turned into Markdown by the app. */
  contenutoHtml: string
  /** The first publication, unix seconds. */
  publishedAt?: number
  audio?: { url: string; mime?: string; peso?: number }
  /** Seconds. */
  durata?: number
  immagine?: string
  stagione?: number
  numero?: number
  tipoEpisodio?: TipoEpisodio
  trascrizioni: FileAllegato[]
  capitoli?: FileAllegato
  persone: Persona[]
  valore?: Valore
  explicit: boolean
}

export interface AvvisoImport {
  codice:
    | 'email-vuota'
    | 'html-descrizioni'
    | 'senza-guid'
    | 'senza-audio'
    | 'guid-calcolato'
    | 'identita-ambigua'
    | 'senza-identita'
  testo: string
  /** The episode it refers to, by title, when it refers to one. */
  episodio?: string
}

/** A Podcasting 2.0 element this import does not carry, with how much of the feed uses it. */
export interface TagNonRiportato {
  tag: string
  nelCanale: boolean
  episodi: number
}

export type EsitoImport =
  | {
      bloccato: true
      /** The `owner` email `podcast:locked` declares, to tell whom to ask. */
      proprietario: string | null
    }
  | {
      bloccato: false
      podcast: PodcastImportato
      /** Oldest first. */
      episodi: EpisodioImportato[]
      /** The sum of the declared `length`s, in bytes. */
      pesoTotale: number
      /** Episodes whose audio declares no length: the total leaves them out. */
      episodiSenzaPeso: number
      avvisi: AvvisoImport[]
      nonRiportati: TagNonRiportato[]
    }

// ── reading helpers ────────────────────────────────────────────────────────

interface Elemento {
  attr: Record<string, string>
  testo: string | null
}

function attributi(apertura: string): Record<string, string> {
  const fuori: Record<string, string> = {}
  for (const m of apertura.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    fuori[m[1] as string] = decodifica(m[2] ?? '')
  }
  return fuori
}

/**
 * Every `<nome …/>` or `<nome …>…</nome>` in the block, in order.
 *
 * Paired and self-closing forms both occur for the same element across hosts
 * (`<podcast:transcript … />`, `<podcast:person …>Name</podcast:person>`).
 */
function elementi(blocco: string, nome: string): Elemento[] {
  const re = new RegExp(`<${nome}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${nome}>)`, 'gi')
  return [...blocco.matchAll(re)].map((m) => ({
    attr: attributi(m[1] ?? ''),
    testo: m[2] === undefined ? null : decodifica(m[2]),
  }))
}

/** A positive whole number, or undefined. */
function intero(valore: string | null | undefined): number | undefined {
  if (valore === null || valore === undefined) return undefined
  const n = Number(valore.trim())
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** `HH:MM:SS`, `MM:SS` or plain seconds, into seconds. */
export function durataInSecondi(valore: string | null | undefined): number | undefined {
  if (!valore) return undefined
  const parti = valore.trim().split(':')
  if (parti.length > 3 || parti.some((p) => !/^\d+(\.\d+)?$/.test(p))) return undefined
  const secondi = parti.reduce((tot, p) => tot * 60 + Number(p), 0)
  return secondi > 0 ? Math.round(secondi) : undefined
}

const esplicito = (v: string | null): boolean => /^(true|yes|explicit)$/i.test(v?.trim() ?? '')

const html = (t: string): boolean => /<[a-z][\s\S]*?>/i.test(t)

function leggiValoreRss(blocco: string): Valore | undefined {
  const testa = /<podcast:value\b([^>]*)>([\s\S]*?)<\/podcast:value>/i.exec(blocco)
  if (!testa) return undefined
  const attr = attributi(testa[1] ?? '')
  const destinatari = elementi(testa[2] ?? '', 'podcast:valueRecipient').flatMap(
    (e): DestinatarioValore[] => {
      const quota = intero(e.attr.split)
      if (!e.attr.address || !quota) return []
      return [
        {
          nome: e.attr.name ?? '',
          tipo: e.attr.type ?? '',
          indirizzo: e.attr.address,
          quota,
          ...(e.attr.customKey ? { customKey: e.attr.customKey } : {}),
          ...(e.attr.customValue ? { customValue: e.attr.customValue } : {}),
          fee: e.attr.fee === 'true',
        },
      ]
    },
  )
  if (!attr.type || !attr.method || destinatari.length === 0) return undefined
  return {
    tipo: attr.type,
    metodo: attr.method,
    ...(attr.suggested ? { suggerito: attr.suggested } : {}),
    destinatari,
  }
}

function leggiPersoneRss(blocco: string): Persona[] {
  return elementi(blocco, 'podcast:person')
    .filter((e) => e.testo)
    .map((e) => ({
      nome: e.testo as string,
      ...(e.attr.role ? { ruolo: e.attr.role } : {}),
      ...(e.attr.group ? { gruppo: e.attr.group } : {}),
      ...(e.attr.img ? { immagine: e.attr.img } : {}),
      ...(e.attr.href ? { link: e.attr.href } : {}),
    }))
}

/** The elements of the podcast namespace this import carries. Everything else is listed. */
const SUPPORTATI = new Set([
  'guid',
  'locked',
  'value',
  'valuerecipient',
  'transcript',
  'chapters',
  'person',
  'funding',
  'season',
  'episode',
])

/**
 * Parts of another element, not elements of their own: listing them would
 * count one thing twice. `valueTimeSplit` is *not* here on purpose — it is a
 * part of the split NMC does not carry, and the creator should know.
 */
const SOTTOELEMENTI = new Set(['source', 'integrity'])

function nomiPodcast(blocco: string): Set<string> {
  return new Set(
    [...blocco.matchAll(/<podcast:([A-Za-z]+)/g)]
      .map((m) => m[1] as string)
      .filter((n) => !SOTTOELEMENTI.has(n.toLowerCase()))
      .map((n) => `podcast:${n}`),
  )
}

// ── the import ─────────────────────────────────────────────────────────────

/**
 * Reads another host's feed.
 *
 * @param urlSorgente the address it was downloaded from, when known. A feed
 *        that declares no `podcast:guid` is known to Podcast Index by the one
 *        computed from its address: the import needs that address to inherit
 *        the identity.
 */
export async function leggiFeedEsterno(xml: string, urlSorgente?: string): Promise<EsitoImport> {
  if (!/<rss\b/i.test(xml)) {
    throw new Error('Non e’ un feed RSS: il documento non contiene <rss>.')
  }
  const { canale, item } = dividiFeed(xml)

  // First of all: a feed its owner has locked against imports is not ours to
  // take, and nothing else about it matters.
  const lock = elementi(canale, 'podcast:locked')[0]
  if (lock && /^yes$/i.test(lock.testo?.trim() ?? '')) {
    return { bloccato: true, proprietario: lock.attr.owner || null }
  }

  const avvisi: AvvisoImport[] = []

  // ── the show ──
  const descrizioneGrezza = tagIn(canale, 'description') ?? tagIn(canale, 'itunes:summary') ?? ''
  const categoria = /<itunes:category\b([^>]*?)(?:\/>|>([\s\S]*?)<\/itunes:category>)/i.exec(canale)
  const principale = categoria ? attributi(categoria[1] ?? '').text : undefined
  const sotto = categoria?.[2] ? attributo(categoria[2], 'itunes:category', 'text') : null
  const proprietario = /<itunes:owner>([\s\S]*?)<\/itunes:owner>/i.exec(canale)?.[1] ?? ''
  const email = tagIn(proprietario, 'itunes:email') || tagIn(canale, 'itunes:email') || undefined
  const tipo = tagIn(canale, 'itunes:type')?.toLowerCase()
  const immagine =
    attributo(canale, 'itunes:image', 'href') ?? tagIn(tagIn(canale, 'image') ?? '', 'url')

  const dichiarato = tagIn(canale, 'podcast:guid') || undefined
  const self =
    [...canale.matchAll(/<atom:link\b([^>]*)>/gi)]
      .map((m) => attributi(m[1] ?? ''))
      .find((a) => a.rel === 'self')?.href || undefined
  let podcastGuid = dichiarato
  if (!podcastGuid) {
    const base = self ?? urlSorgente
    if (base) {
      podcastGuid = await podcastGuidPerUrl(base)
      avvisi.push({
        codice: 'guid-calcolato',
        testo: `Il feed non dichiara un podcast:guid: vale quello calcolato dal suo indirizzo (${podcastGuid}), ed è quello che verrà ereditato.`,
      })
      if (self && urlSorgente && self.replace(/\/+$/, '') !== urlSorgente.replace(/\/+$/, '')) {
        avvisi.push({
          codice: 'identita-ambigua',
          testo: `Il feed dice di stare a ${self}, ma è stato scaricato da ${urlSorgente}: l’identità è calcolata dal primo, che è quello che le directory conoscono.`,
        })
      }
    } else {
      avvisi.push({
        codice: 'senza-identita',
        testo:
          'Il feed non dichiara un podcast:guid e non si sa da quale indirizzo venga: indica l’URL del feed per ereditare l’identità dello show.',
      })
    }
  }

  const finanziamenti = elementi(canale, 'podcast:funding')
    .filter((e) => e.attr.url)
    .map((e) => ({ url: e.attr.url as string, ...(e.testo ? { testo: e.testo } : {}) }))
  const valoreCanale = leggiValoreRss(canale)

  const podcast: PodcastImportato = {
    titolo: tagIn(canale, 'title') ?? '',
    descrizione: testoDaHtml(descrizioneGrezza),
    ...(immagine ? { immagine } : {}),
    ...(tagIn(canale, 'language') ? { lingua: tagIn(canale, 'language') as string } : {}),
    ...(principale ? { categoria: { principale, ...(sotto ? { sotto } : {}) } } : {}),
    ...(email ? { email } : {}),
    ...(tagIn(canale, 'itunes:author') ? { autore: tagIn(canale, 'itunes:author') as string } : {}),
    ...(tipo === 'serial' || tipo === 'episodic' ? { tipo } : {}),
    ...(tagIn(canale, 'link') ? { sito: tagIn(canale, 'link') as string } : {}),
    ...(podcastGuid ? { podcastGuid } : {}),
    podcastGuidCalcolato: !dichiarato && !!podcastGuid,
    explicit: esplicito(tagIn(canale, 'itunes:explicit')),
    ...(valoreCanale ? { valore: valoreCanale } : {}),
    persone: leggiPersoneRss(canale),
    finanziamenti,
  }

  if (!email) {
    avvisi.push({
      codice: 'email-vuota',
      testo:
        'Il feed non dichiara un’email del proprietario: Spotify, Amazon e YouTube la usano per verificare che il podcast sia tuo. Aggiungila nella scheda.',
    })
  }

  // ── the episodes ──
  let conHtml = 0
  const episodi = item.map((b): EpisodioImportato => {
    const titolo = tagIn(b, 'title') ?? '(senza titolo)'
    const descrizioneItem = tagIn(b, 'description') ?? tagIn(b, 'itunes:summary') ?? ''
    const contenuto = tagIn(b, 'content:encoded') ?? descrizioneItem
    if (html(descrizioneItem) || html(contenuto)) conHtml++

    const guid = tagIn(b, 'guid') || undefined
    const data = tagIn(b, 'pubDate')
    const istante = data ? Date.parse(data) : Number.NaN
    const enclosure = elementi(b, 'enclosure')[0]
    const peso = intero(enclosure?.attr.length)
    const tipoEp = tagIn(b, 'itunes:episodeType')?.toLowerCase()
    const capitoli = elementi(b, 'podcast:chapters').find((e) => e.attr.url)
    const valore = leggiValoreRss(b)

    if (!guid) {
      avvisi.push({
        codice: 'senza-guid',
        episodio: titolo,
        testo: `«${titolo}» non ha un GUID: le app lo riconoscono dall’URL dell’audio. Per non farlo sembrare un episodio nuovo, tieni per lui l’URL originale invece di copiarlo su Blossom.`,
      })
    }
    if (!enclosure?.attr.url) {
      avvisi.push({
        codice: 'senza-audio',
        episodio: titolo,
        testo: `«${titolo}» non ha un audio (enclosure): non può diventare un episodio e verrà saltato.`,
      })
    }

    return {
      ...(guid ? { guid } : {}),
      titolo,
      descrizione: testoDaHtml(descrizioneItem),
      contenutoHtml: contenuto,
      ...(Number.isFinite(istante) ? { publishedAt: Math.floor(istante / 1000) } : {}),
      ...(enclosure?.attr.url
        ? {
            audio: {
              url: enclosure.attr.url,
              ...(enclosure.attr.type ? { mime: enclosure.attr.type } : {}),
              ...(peso ? { peso } : {}),
            },
          }
        : {}),
      ...(durataInSecondi(tagIn(b, 'itunes:duration'))
        ? { durata: durataInSecondi(tagIn(b, 'itunes:duration')) as number }
        : {}),
      ...(attributo(b, 'itunes:image', 'href')
        ? { immagine: attributo(b, 'itunes:image', 'href') as string }
        : {}),
      ...((intero(tagIn(b, 'itunes:season')) ?? intero(tagIn(b, 'podcast:season')))
        ? {
            stagione: (intero(tagIn(b, 'itunes:season')) ??
              intero(tagIn(b, 'podcast:season'))) as number,
          }
        : {}),
      ...((intero(tagIn(b, 'itunes:episode')) ?? intero(tagIn(b, 'podcast:episode')))
        ? {
            numero: (intero(tagIn(b, 'itunes:episode')) ??
              intero(tagIn(b, 'podcast:episode'))) as number,
          }
        : {}),
      ...(tipoEp && (TIPI_EPISODIO as readonly string[]).includes(tipoEp)
        ? { tipoEpisodio: tipoEp as TipoEpisodio }
        : {}),
      trascrizioni: elementi(b, 'podcast:transcript')
        .filter((e) => e.attr.url)
        .map((e) => ({ url: e.attr.url as string, ...(e.attr.type ? { mime: e.attr.type } : {}) })),
      ...(capitoli
        ? {
            capitoli: {
              url: capitoli.attr.url as string,
              ...(capitoli.attr.type ? { mime: capitoli.attr.type } : {}),
            },
          }
        : {}),
      persone: leggiPersoneRss(b),
      ...(valore ? { valore } : {}),
      explicit: esplicito(tagIn(b, 'itunes:explicit')),
    }
  })

  if (conHtml > 0) {
    avvisi.push({
      codice: 'html-descrizioni',
      testo: `${conHtml} episodi hanno descrizioni in HTML: vengono trasformate in testo semplice (YouTube rifiuta l’HTML) e le note in Markdown.`,
    })
  }

  // Oldest first, the undated ones last in their original order.
  const ordinati = episodi
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const da = a.e.publishedAt ?? Number.POSITIVE_INFINITY
      const db = b.e.publishedAt ?? Number.POSITIVE_INFINITY
      return da === db ? a.i - b.i : da - db
    })
    .map(({ e }) => e)

  // What this import does not carry, so the creator decides knowingly.
  const conteggio = new Map<string, TagNonRiportato>()
  const nonSupportato = (n: string): boolean =>
    !SUPPORTATI.has(n.slice('podcast:'.length).toLowerCase())
  for (const n of nomiPodcast(canale)) {
    if (nonSupportato(n)) conteggio.set(n, { tag: n, nelCanale: true, episodi: 0 })
  }
  for (const b of item) {
    for (const n of nomiPodcast(b)) {
      if (!nonSupportato(n)) continue
      const voce = conteggio.get(n) ?? { tag: n, nelCanale: false, episodi: 0 }
      voce.episodi++
      conteggio.set(n, voce)
    }
  }

  return {
    bloccato: false,
    podcast,
    episodi: ordinati,
    pesoTotale: ordinati.reduce((t, e) => t + (e.audio?.peso ?? 0), 0),
    episodiSenzaPeso: ordinati.filter((e) => e.audio && !e.audio.peso).length,
    avvisi,
    nonRiportati: [...conteggio.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
  }
}
