import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue, tagsNamed } from '../tags.js'

/**
 * Kind 54 — episodio di podcast (NIP-F4).
 *
 * E' l'unico kind audio standardizzato: nell'indice dei NIP non esiste un
 * "brano musicale" o un "file audio" generico. Chi vuole pubblicare un audio
 * che si veda nei client sociali usa una nota (kind 1) con un allegato
 * `imeta`; il kind 54 serve quando il contenuto e' davvero un episodio, e si
 * vuole che i lettori di podcast lo trovino.
 *
 * **Il modello di NIP-F4 e' particolare e va detto**: ogni podcast e' una
 * *chiave a se'*, e gli episodi sono firmati direttamente da quella chiave.
 * Pubblicando un kind 54 con la propria identita' personale, quell'identita'
 * *diventa* il podcast — non c'e' un livello intermedio. La descrizione dello
 * show sta nel kind 10154, replaceable, sulla stessa chiave.
 *
 * Differenza tecnica rispetto ai kind media: l'audio si dichiara con un tag
 * `audio` (url piu' tipo MIME facoltativo), **non** con `imeta`. Non c'e'
 * quindi hash ne' dimensione, e chi ascolta non puo' verificare che il file
 * sia quello pubblicato. E' la specifica a volerlo cosi'.
 */

export const podcastEpisodeSchema = z.object({
  /** Note dell'episodio, in Markdown. */
  content: z.string(),
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  /** Sorgenti audio, in ordine. La prima e' quella principale. */
  audio: z.array(z.object({ url: z.string(), mime: z.string().optional() })),
})

export type PodcastEpisodeParsed = z.infer<typeof podcastEpisodeSchema>

export interface PodcastEpisodeInput {
  content?: string
  title: string
  description?: string
  image?: string
  audio: { url: string; mime?: string }[]
}

export const podcastEpisodeDefinition = defineKind<PodcastEpisodeParsed, PodcastEpisodeInput>({
  kind: 54,
  name: 'episodio-podcast',
  nip: 'NIP-F4',
  class: 'regular',
  editable: false, // regolare: immutabile, come una nota
  deletable: true,
  schema: podcastEpisodeSchema,
  feed: { eligible: true, requiresMedia: true },
  renderer: 'podcast',

  parse(event) {
    const title = tagValue(event, 'title')
    if (title === undefined) {
      throw new Error(`kind 54 senza tag "title": evento ${event.id}`)
    }

    const description = tagValue(event, 'description')
    const image = tagValue(event, 'image')

    return podcastEpisodeSchema.parse({
      content: event.content,
      title,
      ...(description !== undefined ? { description } : {}),
      ...(image !== undefined ? { image } : {}),
      audio: tagsNamed(event, 'audio')
        .filter((t) => typeof t[1] === 'string' && t[1] !== '')
        .map((t) => ({
          url: t[1] as string,
          ...(t[2] ? { mime: t[2] } : {}),
        })),
    })
  },

  build(input, ctx) {
    if (input.title.trim() === '') {
      throw new Error('Un episodio ha bisogno di un titolo: e’ come lo si trova in un lettore.')
    }
    if (input.audio.length === 0) {
      throw new Error(
        'Un episodio senza sorgente audio non e’ ascoltabile. Per un testo senza audio usa una nota o un articolo.',
      )
    }

    return {
      kind: 54,
      content: input.content ?? '',
      tags: [
        ['title', input.title.trim()],
        ...optionalTag('description', input.description),
        ...optionalTag('image', input.image),
        // Il tipo MIME e' facoltativo per la specifica, ma senza il lettore
        // deve indovinarlo dall'estensione dell'URL.
        ...input.audio.map((a) => (a.mime ? ['audio', a.url, a.mime] : ['audio', a.url])),
      ],
      created_at: ctx.now,
    }
  },
})

/**
 * Kind 10154 — descrizione del podcast (NIP-F4).
 *
 * Replaceable, sulla chiave del podcast. I lettori di podcast leggono questo e
 * possono ignorare del tutto il kind 0: e' la scheda dello *show*, non della
 * persona, anche quando le due chiavi coincidono.
 */
export const podcastMetadataSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  websites: z.array(z.string()),
  /** Autori dichiarati, con il ruolo: `host`, `cohost` o `editor`. */
  authors: z.array(z.object({ pubkey: z.string(), role: z.string().optional() })),
})

export type PodcastMetadataParsed = z.infer<typeof podcastMetadataSchema>

export interface PodcastMetadataInput {
  title: string
  description?: string
  image?: string
  websites?: string[]
  authors?: { pubkey: string; role?: string }[]
}

export const podcastMetadataDefinition = defineKind<PodcastMetadataParsed, PodcastMetadataInput>({
  kind: 10154,
  name: 'descrizione-podcast',
  nip: 'NIP-F4',
  class: 'replaceable',
  editable: true,
  deletable: true,
  schema: podcastMetadataSchema,
  feed: { eligible: false },
  renderer: 'podcast-show',

  parse(event) {
    const title = tagValue(event, 'title')
    if (title === undefined) {
      throw new Error(`kind 10154 senza tag "title": evento ${event.id}`)
    }
    const description = tagValue(event, 'description')
    const image = tagValue(event, 'image')

    return podcastMetadataSchema.parse({
      title,
      ...(description !== undefined ? { description } : {}),
      ...(image !== undefined ? { image } : {}),
      websites: tagsNamed(event, 'website')
        .map((t) => t[1])
        .filter((u): u is string => typeof u === 'string' && u !== ''),
      authors: tagsNamed(event, 'p')
        .filter((t) => typeof t[1] === 'string')
        .map((t) => ({ pubkey: t[1] as string, ...(t[2] ? { role: t[2] } : {}) })),
    })
  },

  build(input, ctx) {
    if (input.title.trim() === '') {
      throw new Error('Il podcast ha bisogno di un titolo.')
    }

    return {
      kind: 10154,
      content: '',
      tags: [
        ['title', input.title.trim()],
        ...optionalTag('description', input.description),
        ...optionalTag('image', input.image),
        ...(input.websites ?? []).filter(Boolean).map((w) => ['website', w]),
        // Il ruolo dichiarato qui non prova nulla da solo: NIP-F4 chiede di
        // riscontrarlo con il kind 10064 pubblicato dall'autore stesso, perche'
        // un podcast puo' attribuirsi chiunque.
        ...(input.authors ?? []).map((a) => (a.role ? ['p', a.pubkey, a.role] : ['p', a.pubkey])),
      ],
      created_at: ctx.now,
    }
  },
})
