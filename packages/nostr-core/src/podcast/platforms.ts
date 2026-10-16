import type { CategoriaPodcast } from './categories.js'

/**
 * The podcast platforms, as data, and their checklist.
 *
 * They nearly all ask for the same five things — a square cover, a category,
 * a language, explicit, an email in the feed — but not all of them demand
 * these, and each verifies ownership in its own way. Putting them in a table
 * lets the client say, for each one, *what is missing* instead of a generic
 * «the feed is not valid». The sources for the requirements are in the
 * `docs/PODCAST.md` guide.
 */

export type RequisitoPiattaforma =
  'copertina-quadrata' | 'categoria' | 'lingua' | 'email' | 'descrizione' | 'episodio-mp3'

export interface Piattaforma {
  id: 'podcastindex' | 'apple' | 'spotify' | 'amazon' | 'youtube'
  nome: string
  /** Where the feed gets submitted. */
  sottoponiSu: string
  /** The domains that identify the show's link on that platform. */
  dominiShow: readonly string[]
  /** Where it takes the feed from: directly, or from a directory. */
  legge: 'feed' | 'podcastindex'
  requisiti: readonly RequisitoPiattaforma[]
  /** How it verifies that the podcast is yours. */
  verificaProprieta: string
  nota?: string
}

export const PIATTAFORME: readonly Piattaforma[] = [
  {
    id: 'podcastindex',
    nome: 'Podcast Index',
    sottoponiSu: 'https://podcastindex.org/add',
    dominiShow: ['podcastindex.org'],
    legge: 'feed',
    requisiti: ['descrizione'],
    verificaProprieta: 'Nessuna: indicizza qualunque feed valido.',
    nota: 'La directory aperta da cui leggono Fountain, Podverse, Castamatic e gli altri. Va per prima: senza, per quelle app il podcast non esiste.',
  },
  {
    id: 'apple',
    nome: 'Apple Podcasts',
    sottoponiSu: 'https://podcastsconnect.apple.com/',
    dominiShow: ['podcasts.apple.com'],
    legge: 'feed',
    requisiti: ['copertina-quadrata', 'categoria', 'lingua', 'descrizione', 'episodio-mp3'],
    verificaProprieta: 'Account Apple in Podcasts Connect. L’email nel feed non e’ obbligatoria.',
    nota: 'Da qui leggono anche Overcast, Pocket Casts, Castro e Podcast Addict.',
  },
  {
    id: 'spotify',
    nome: 'Spotify',
    sottoponiSu: 'https://creators.spotify.com/',
    dominiShow: ['open.spotify.com'],
    legge: 'feed',
    requisiti: ['copertina-quadrata', 'email', 'descrizione', 'episodio-mp3'],
    verificaProprieta:
      'Manda un codice all’email nel feed (itunes:email): senza, non si puo’ sottoporre.',
  },
  {
    id: 'amazon',
    nome: 'Amazon Music',
    sottoponiSu: 'https://podcasters.amazon.com/',
    dominiShow: ['music.amazon.com', 'music.amazon.it', 'music.amazon.co.uk', 'music.amazon.de'],
    legge: 'feed',
    requisiti: [
      'copertina-quadrata',
      'categoria',
      'lingua',
      'email',
      'descrizione',
      'episodio-mp3',
    ],
    verificaProprieta: 'Manda una verifica all’email nel feed.',
    nota: 'Vale anche per Audible.',
  },
  {
    id: 'youtube',
    nome: 'YouTube Music',
    sottoponiSu: 'https://studio.youtube.com/',
    dominiShow: ['youtube.com', 'music.youtube.com', 'www.youtube.com'],
    legge: 'feed',
    requisiti: ['copertina-quadrata', 'email', 'episodio-mp3'],
    verificaProprieta: 'Manda un codice all’email nel feed (itunes:email).',
    nota: 'Trasforma ogni episodio in un video con la copertina fissa: per questo la vuole quadrata.',
  },
]

/** What the checklist looks at: the 10154 card's data plus the cover's measurements. */
export interface SchedaPerPiattaforme {
  description?: string
  image?: string
  categories?: readonly CategoriaPodcast[]
  language?: string
  email?: string
  websites?: readonly string[]
  /** The MIMEs of the known episodes' audio; empty when there are none. */
  mimeEpisodi?: readonly string[]
}

export interface MisureCopertina {
  larghezza: number
  altezza: number
}

export const COPERTINA_MIN = 1400
export const COPERTINA_MAX = 3000

/** True when the cover suits every platform: square, between 1400 and 3000. */
export function copertinaConforme(m: MisureCopertina | null): boolean {
  if (!m) return false
  return m.larghezza === m.altezza && m.larghezza >= COPERTINA_MIN && m.larghezza <= COPERTINA_MAX
}

export interface VoceChecklist {
  requisito: RequisitoPiattaforma
  ok: boolean
  /** What is missing, in words; empty when ok. The UI shows it, so it stays Italian. */
  testo: string
}

export interface EsitoPiattaforma {
  pronta: boolean
  voci: VoceChecklist[]
  /** The show's link on that platform, when the card declares it among the websites. */
  urlShow: string | null
}

const MIME_MP3_M4A = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a']

function dominioDi(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The first website on the card that sits on one of the platform's domains. */
export function urlShowSu(
  piattaforma: Piattaforma,
  websites: readonly string[] = [],
): string | null {
  for (const w of websites) {
    const d = dominioDi(w)
    if (d && piattaforma.dominiShow.some((x) => d === x || d.endsWith(`.${x}`))) return w
  }
  return null
}

/**
 * One platform's checklist against the real data.
 *
 * It does not decide whether to submit: it says what the platform would
 * refuse. A ✗ here is a piece of data to add to the profile, not an error.
 */
export function verificaPiattaforma(
  piattaforma: Piattaforma,
  scheda: SchedaPerPiattaforme,
  copertina: MisureCopertina | null,
): EsitoPiattaforma {
  const voci: VoceChecklist[] = piattaforma.requisiti.map((r): VoceChecklist => {
    switch (r) {
      case 'copertina-quadrata': {
        if (!scheda.image) return { requisito: r, ok: false, testo: 'manca la copertina' }
        if (!copertina) {
          return { requisito: r, ok: false, testo: 'copertina non misurabile: controlla l’URL' }
        }
        if (copertinaConforme(copertina)) return { requisito: r, ok: true, testo: '' }
        const forma =
          copertina.larghezza !== copertina.altezza
            ? 'non e’ quadrata'
            : copertina.larghezza < COPERTINA_MIN
              ? `e’ sotto i ${COPERTINA_MIN} px`
              : `supera i ${COPERTINA_MAX} px`
        return {
          requisito: r,
          ok: false,
          testo: `copertina ${copertina.larghezza}×${copertina.altezza}: ${forma} (serve un quadrato da ${COPERTINA_MIN} a ${COPERTINA_MAX})`,
        }
      }
      case 'categoria':
        return scheda.categories?.length
          ? { requisito: r, ok: true, testo: '' }
          : { requisito: r, ok: false, testo: 'manca la categoria' }
      case 'lingua':
        return scheda.language
          ? { requisito: r, ok: true, testo: '' }
          : { requisito: r, ok: false, testo: 'manca la lingua' }
      case 'email':
        return scheda.email
          ? { requisito: r, ok: true, testo: '' }
          : { requisito: r, ok: false, testo: 'manca l’email: e’ lì che arriva la verifica' }
      case 'descrizione':
        return scheda.description?.trim()
          ? { requisito: r, ok: true, testo: '' }
          : { requisito: r, ok: false, testo: 'manca la descrizione' }
      case 'episodio-mp3': {
        const mime = scheda.mimeEpisodi ?? []
        if (mime.length === 0)
          return { requisito: r, ok: false, testo: 'nessun episodio pubblicato' }
        const fuori = mime.filter(
          (m) => !MIME_MP3_M4A.includes(m.toLowerCase().split(';')[0] ?? ''),
        )
        return fuori.length
          ? {
              requisito: r,
              ok: false,
              testo: `${fuori.length} episodi non in mp3/m4a (${[...new Set(fuori)].join(', ')})`,
            }
          : { requisito: r, ok: true, testo: '' }
      }
    }
  })
  return {
    pronta: voci.every((v) => v.ok),
    voci,
    urlShow: urlShowSu(piattaforma, scheda.websites),
  }
}
