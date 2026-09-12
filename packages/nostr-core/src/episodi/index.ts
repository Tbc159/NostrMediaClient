import { z } from 'zod'

import type { ImetaInput } from '../kinds/imeta.js'
import type { BlobDescriptor } from '../media/blossom.js'

/**
 * Bozza di episodio: il lavoro di pubblicazione prima che diventi un evento.
 *
 * Porta **i dati del form e i file gia' su Blossom**, non un evento. E' la
 * stessa cosa in tre usi: salvata nel browser e' una bozza da riprendere,
 * scaricata come file e' una proposta da consegnare a un'altra identita',
 * importata da quell'identita' e' un episodio da controllare e firmare. Chi
 * firma ricompone dal form cio' che vede: non gli arriva mai un evento gia'
 * impacchettato da qualcun altro.
 *
 * Per questo puo' essere **incompleta**: e' il suo scopo. `completezza()` dice
 * cosa manca, e sta al pulsante «pubblica» consultarla.
 */

export const VERSIONE_BOZZA_EPISODIO = 1 as const

const allegatoSchema = z.object({
  nome: z.string(),
  imeta: z.object({ url: z.string().min(1) }).passthrough(),
  descrittore: z.object({
    url: z.string().min(1),
    sha256: z.string().min(1),
    size: z.number(),
    type: z.string(),
    uploaded: z.number(),
  }),
  copie: z.array(z.string()),
})

export const bozzaEpisodioSchema = z.object({
  versione: z.literal(VERSIONE_BOZZA_EPISODIO),
  kind: z.literal(54),
  id: z.string().min(1),
  creataAlle: z.number(),
  aggiornataAlle: z.number(),
  /** Chi l'ha preparata, in npub. Solo informativo. */
  preparataDa: z.string().optional(),
  /** Chi dovrebbe pubblicarla, in npub. Se chi importa e' un altro, si avvisa: non si vieta. */
  perChiave: z.string().optional(),
  episodio: z.object({
    titolo: z.string(),
    descrizione: z.string(),
    contenuto: z.string(),
    hashtag: z.array(z.string()),
    immagine: z.string().optional(),
  }),
  allegati: z.array(allegatoSchema),
})

/** Un file gia' su Blossom, nella forma che il caricatore sa riadottare. */
export interface AllegatoBozza {
  nome: string
  imeta: ImetaInput
  descrittore: BlobDescriptor
  copie: string[]
}

export interface BozzaEpisodio {
  versione: typeof VERSIONE_BOZZA_EPISODIO
  kind: 54
  id: string
  creataAlle: number
  aggiornataAlle: number
  preparataDa?: string
  perChiave?: string
  episodio: {
    titolo: string
    descrizione: string
    contenuto: string
    hashtag: string[]
    immagine?: string
  }
  allegati: AllegatoBozza[]
}

export interface DatiBozzaEpisodio {
  /** Assente per una bozza nuova: viene generato. */
  id?: string
  creataAlle?: number
  preparataDa?: string
  perChiave?: string
  episodio: BozzaEpisodio['episodio']
  allegati: AllegatoBozza[]
  /** Iniettabile nei test. */
  adesso?: () => number
}

function nuovoId(): string {
  const casuale =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `episodio-${casuale}`
}

/** Timbra una bozza. Valida la forma, non la completezza: puo' mancare tutto. */
export function creaBozzaEpisodio(dati: DatiBozzaEpisodio): BozzaEpisodio {
  const adesso = (dati.adesso ?? (() => Math.floor(Date.now() / 1000)))()
  return bozzaEpisodioSchema.parse({
    versione: VERSIONE_BOZZA_EPISODIO,
    kind: 54,
    id: dati.id ?? nuovoId(),
    creataAlle: dati.creataAlle ?? adesso,
    aggiornataAlle: adesso,
    ...(dati.preparataDa ? { preparataDa: dati.preparataDa } : {}),
    ...(dati.perChiave ? { perChiave: dati.perChiave } : {}),
    episodio: {
      titolo: dati.episodio.titolo,
      descrizione: dati.episodio.descrizione,
      contenuto: dati.episodio.contenuto,
      hashtag: dati.episodio.hashtag,
      ...(dati.episodio.immagine ? { immagine: dati.episodio.immagine } : {}),
    },
    allegati: dati.allegati,
  }) as BozzaEpisodio
}

/**
 * Legge una bozza da testo JSON — un file importato, o lo storage.
 *
 * @throws con un messaggio leggibile se non e' una bozza, o se e' di una
 *         versione che questo client non conosce: meglio dirlo che caricare
 *         un form a meta' senza spiegazioni.
 */
export function leggiBozzaEpisodio(testo: string): BozzaEpisodio {
  let grezzo: unknown
  try {
    grezzo = JSON.parse(testo)
  } catch {
    throw new Error('Il file non contiene JSON valido.')
  }

  const versione = (grezzo as { versione?: unknown } | null)?.versione
  if (typeof versione === 'number' && versione !== VERSIONE_BOZZA_EPISODIO) {
    throw new Error(
      `Bozza di versione ${versione}: questo client legge la versione ${VERSIONE_BOZZA_EPISODIO}.`,
    )
  }

  const esito = bozzaEpisodioSchema.safeParse(grezzo)
  if (!esito.success) {
    const primo = esito.error.issues[0]
    const dove = primo?.path.length ? ` (${primo.path.join('.')})` : ''
    throw new Error(`Non e’ una bozza di episodio${dove}: ${primo?.message ?? 'forma inattesa'}.`)
  }
  return esito.data as BozzaEpisodio
}

export interface Completezza {
  pronta: boolean
  /** Cosa manca per poter pubblicare, nell'ordine in cui va colmato. */
  manca: string[]
}

/**
 * Cosa manca perche' la bozza diventi un kind 54 valido.
 *
 * Rispecchia i controlli di `podcastEpisodeDefinition.build`, ma prima e
 * senza lanciare: serve a un pulsante per spiegarsi, non a un errore.
 */
export function completezzaEpisodio(b: Pick<BozzaEpisodio, 'episodio' | 'allegati'>): Completezza {
  const manca: string[] = []
  if (b.episodio.titolo.trim() === '') manca.push('il titolo')
  if (b.episodio.descrizione.trim() === '') manca.push('la descrizione')
  if (!b.allegati.some((a) => (a.imeta.mime ?? a.descrittore.type).startsWith('audio/'))) {
    manca.push('un file audio su Blossom')
  }
  return { pronta: manca.length === 0, manca }
}
