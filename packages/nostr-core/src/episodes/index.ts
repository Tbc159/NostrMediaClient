import { z } from 'zod'

import { TIPI_EPISODIO, type TipoEpisodio } from '../kinds/definitions/podcast.js'
import type { ImetaInput } from '../kinds/imeta.js'
import type { BlobDescriptor } from '../media/blossom.js'

/**
 * An episode draft: the publishing work before it becomes an event.
 *
 * It carries **the form's data and the files already on Blossom**, not an
 * event. It is the same thing in three uses: saved in the browser it is a
 * draft to pick up again, downloaded as a file it is a proposal to hand to
 * another identity, imported by that identity it is an episode to check and
 * sign. Whoever signs recomposes from the form what they can see: they never
 * receive an event already packaged by someone else.
 *
 * That is why it can be **incomplete**: that is its purpose. `completezza()`
 * says what is missing, and it is up to the «publish» button to consult it.
 *
 * The messages stay in Italian: they are shown when a proposal is imported.
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
  /** Who prepared it, as an npub. Informational only. */
  preparataDa: z.string().optional(),
  /** Who should publish it, as an npub. If the importer is someone else we warn: we do not forbid. */
  perChiave: z.string().optional(),
  episodio: z.object({
    titolo: z.string(),
    descrizione: z.string(),
    contenuto: z.string(),
    hashtag: z.array(z.string()),
    immagine: z.string().optional(),
    // For an episode that comes from another host: optional, so the drafts
    // saved before these fields existed still read as version 1.
    guidOriginale: z.string().optional(),
    publishedAt: z.number().int().positive().optional(),
    stagione: z.number().int().positive().optional(),
    numero: z.number().int().positive().optional(),
    tipoEpisodio: z.enum(TIPI_EPISODIO).optional(),
  }),
  allegati: z.array(allegatoSchema),
})

/** A file already on Blossom, in the shape the uploader can adopt again. */
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
    guidOriginale?: string
    publishedAt?: number
    stagione?: number
    numero?: number
    tipoEpisodio?: TipoEpisodio
  }
  allegati: AllegatoBozza[]
}

export interface DatiBozzaEpisodio {
  /** Absent for a new draft: it gets generated. */
  id?: string
  creataAlle?: number
  preparataDa?: string
  perChiave?: string
  episodio: BozzaEpisodio['episodio']
  allegati: AllegatoBozza[]
  /** Injectable in tests. */
  adesso?: () => number
}

function nuovoId(): string {
  const casuale =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `episodio-${casuale}`
}

/** Stamps a draft. It validates the shape, not completeness: anything may be missing. */
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
      ...(dati.episodio.guidOriginale ? { guidOriginale: dati.episodio.guidOriginale } : {}),
      ...(dati.episodio.publishedAt ? { publishedAt: dati.episodio.publishedAt } : {}),
      ...(dati.episodio.stagione ? { stagione: dati.episodio.stagione } : {}),
      ...(dati.episodio.numero ? { numero: dati.episodio.numero } : {}),
      ...(dati.episodio.tipoEpisodio ? { tipoEpisodio: dati.episodio.tipoEpisodio } : {}),
    },
    allegati: dati.allegati,
  }) as BozzaEpisodio
}

/**
 * Reads a draft from JSON text — an imported file, or storage.
 *
 * @throws with a readable message if it is not a draft, or if it is of a
 *         version this client does not know: better to say so than to load
 *         half a form with no explanation.
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
    throw new Error(`Non è una bozza di episodio${dove}: ${primo?.message ?? 'forma inattesa'}.`)
  }
  return esito.data as BozzaEpisodio
}

export interface Completezza {
  pronta: boolean
  /** What is missing before publishing is possible, in the order to fill it in. */
  manca: string[]
}

/**
 * What is missing for the draft to become a valid kind 54.
 *
 * It mirrors the checks in `podcastEpisodeDefinition.build`, but earlier and
 * without throwing: it is there for a button to explain itself, not for an
 * error.
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
