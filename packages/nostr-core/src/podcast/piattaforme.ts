import type { CategoriaPodcast } from './categorie.js'

/**
 * Le piattaforme di podcast, come dati, e la loro checklist.
 *
 * Chiedono quasi tutte le stesse cinque cose — copertina quadrata,
 * categoria, lingua, explicit, email nel feed — ma non tutte le pretendono, e
 * ognuna verifica la proprieta' a modo suo. Metterle in una tabella permette
 * al client di dire, per ciascuna, *cosa manca* invece di un generico «il
 * feed non e' valido». Le fonti dei requisiti sono nella guida
 * `docs/PODCAST.md`.
 */

export type RequisitoPiattaforma =
  'copertina-quadrata' | 'categoria' | 'lingua' | 'email' | 'descrizione' | 'episodio-mp3'

export interface Piattaforma {
  id: 'podcastindex' | 'apple' | 'spotify' | 'amazon' | 'youtube'
  nome: string
  /** Dove si sottopone il feed. */
  sottoponiSu: string
  /** Domini che identificano il link dello show su quella piattaforma. */
  dominiShow: readonly string[]
  /** Da chi prende il feed: direttamente, o da una directory. */
  legge: 'feed' | 'podcastindex'
  requisiti: readonly RequisitoPiattaforma[]
  /** Come verifica che il podcast sia tuo. */
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

/** Quello che la checklist guarda: i dati della scheda 10154 piu' le misure della copertina. */
export interface SchedaPerPiattaforme {
  description?: string
  image?: string
  categories?: readonly CategoriaPodcast[]
  language?: string
  email?: string
  websites?: readonly string[]
  /** MIME degli audio degli episodi noti; vuoto se non ce ne sono. */
  mimeEpisodi?: readonly string[]
}

export interface MisureCopertina {
  larghezza: number
  altezza: number
}

export const COPERTINA_MIN = 1400
export const COPERTINA_MAX = 3000

/** Vero se la copertina va bene per tutte le piattaforme: quadrata, fra 1400 e 3000. */
export function copertinaConforme(m: MisureCopertina | null): boolean {
  if (!m) return false
  return m.larghezza === m.altezza && m.larghezza >= COPERTINA_MIN && m.larghezza <= COPERTINA_MAX
}

export interface VoceChecklist {
  requisito: RequisitoPiattaforma
  ok: boolean
  /** Cosa manca, in parole; vuoto se ok. */
  testo: string
}

export interface EsitoPiattaforma {
  pronta: boolean
  voci: VoceChecklist[]
  /** Il link dello show su quella piattaforma, se la scheda lo dichiara fra i siti. */
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

/** Il primo sito della scheda che sta su uno dei domini della piattaforma. */
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
 * La checklist di una piattaforma sui dati reali.
 *
 * Non decide se sottoporre: dice cosa la piattaforma rifiuterebbe. Un ✗ qui
 * e' un dato da aggiungere nel profilo, non un errore.
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
