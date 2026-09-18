import { z } from 'zod'

import { MAX_CATEGORIE, isCategoriaApple } from '../../podcast/categorie.js'
import { defineKind } from '../registry.js'
import { optionalTag, repeatedTags, tagValue, tagsNamed } from '../tags.js'

/*
 * Oltre a NIP-F4.
 *
 * Le piattaforme di podcast — Apple, Spotify, Amazon, YouTube — pretendono nel
 * feed RSS cose che NIP-F4 non prevede: categoria, lingua, un'email a cui
 * mandare la verifica di proprieta', un flag «explicit», la durata degli
 * episodi. Il feed lo genera un servizio a partire dagli eventi, quindi quei
 * dati devono stare *negli eventi*. Convenzione, condivisa con il servizio:
 *
 *   10154  ["category", "News", "Daily News"]   fino a tre, la prima e' la primaria
 *          ["language", "it"]                   ISO 639-1
 *          ["email", "owner@…"]                 pubblica, come lo e' gia' nel feed
 *          ["content-warning", "…"]             NIP-36, gia' standard: presente = explicit
 *   54     ["duration", "3600"]                 secondi interi, come NIP-71
 *          ["content-warning", "…"]             explicit del singolo episodio
 *
 * I link dello show sulle piattaforme sono siti, e NIP-F4 ne ammette piu'
 * d'uno: vanno nei `website`, dopo il sito del podcast, senza tag nuovi.
 */

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
  /** Durata in secondi, se dichiarata: il feed la mette in itunes:duration. */
  duration: z.number().optional(),
  /** Contenuto esplicito (NIP-36): il motivo, se c'e'. */
  contentWarning: z.string().optional(),
})

export type PodcastEpisodeParsed = z.infer<typeof podcastEpisodeSchema>

export interface PodcastEpisodeInput {
  content?: string
  title: string
  description?: string
  image?: string
  audio: { url: string; mime?: string }[]
  /** Secondi; viene arrotondata. */
  duration?: number
  /** Presente (anche vuoto) = episodio esplicito. */
  contentWarning?: string
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
    const durata = Number(tagValue(event, 'duration'))
    const avviso = tagsNamed(event, 'content-warning')[0]

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
      ...(Number.isFinite(durata) && durata > 0 ? { duration: durata } : {}),
      ...(avviso ? { contentWarning: avviso[1] ?? '' } : {}),
    })
  },

  build(input, ctx) {
    if (input.title.trim() === '') {
      throw new Error('Un episodio ha bisogno di un titolo: e’ come lo si trova in un lettore.')
    }
    // Obbligatoria per NIP-F4. Il `parse` la accetta assente — eventi altrui —
    // ma cio' che si pubblica da qui deve essere conforme.
    if (!input.description || input.description.trim() === '') {
      throw new Error(
        'Un episodio ha bisogno di una descrizione: i lettori di podcast la mostrano sotto il titolo.',
      )
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
        ['description', input.description.trim()],
        ...optionalTag('image', input.image),
        // Il tipo MIME e' facoltativo per la specifica, ma senza il lettore
        // deve indovinarlo dall'estensione dell'URL.
        ...input.audio.map((a) => (a.mime ? ['audio', a.url, a.mime] : ['audio', a.url])),
        ...(input.duration && input.duration > 0
          ? [['duration', String(Math.round(input.duration))]]
          : []),
        ...(input.contentWarning !== undefined ? [['content-warning', input.contentWarning]] : []),
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
  /** Categorie Apple, la prima e' la primaria. */
  categories: z.array(z.object({ principale: z.string(), sotto: z.string().optional() })),
  language: z.string().optional(),
  email: z.string().optional(),
  contentWarning: z.string().optional(),
})

export type PodcastMetadataParsed = z.infer<typeof podcastMetadataSchema>

export interface PodcastMetadataInput {
  title: string
  description?: string
  image?: string
  websites?: string[]
  authors?: { pubkey: string; role?: string }[]
  categories?: { principale: string; sotto?: string }[]
  language?: string
  email?: string
  /** Presente (anche vuoto) = podcast esplicito. */
  contentWarning?: string
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

    const language = tagValue(event, 'language')
    const email = tagValue(event, 'email')
    const avviso = tagsNamed(event, 'content-warning')[0]

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
      // Tollerante: una categoria che Apple non conosce si legge lo stesso,
      // e' la build a rifiutarla quando la scriviamo noi.
      categories: tagsNamed(event, 'category')
        .filter((t) => typeof t[1] === 'string' && t[1] !== '')
        .map((t) => ({ principale: t[1] as string, ...(t[2] ? { sotto: t[2] } : {}) })),
      ...(language ? { language } : {}),
      ...(email ? { email } : {}),
      ...(avviso ? { contentWarning: avviso[1] ?? '' } : {}),
    })
  },

  build(input, ctx) {
    if (input.title.trim() === '') {
      throw new Error('Il podcast ha bisogno di un titolo.')
    }
    // Immagine e descrizione sono obbligatorie per NIP-F4: sono cio' che un
    // lettore di podcast mostra nell'elenco degli show. Il `parse` resta
    // tollerante con le schede altrui.
    if (!input.description || input.description.trim() === '') {
      throw new Error('La scheda del podcast ha bisogno di una descrizione.')
    }
    if (!input.image || input.image.trim() === '') {
      throw new Error('La scheda del podcast ha bisogno di un’immagine di copertina.')
    }
    const categorie = (input.categories ?? []).filter((c) => c.principale.trim() !== '')
    if (categorie.length > MAX_CATEGORIE) {
      throw new Error(`Apple accetta al massimo ${MAX_CATEGORIE} categorie.`)
    }
    for (const c of categorie) {
      if (!isCategoriaApple(c)) {
        throw new Error(
          `«${c.sotto ? `${c.principale} / ${c.sotto}` : c.principale}» non e’ una categoria di Apple Podcasts.`,
        )
      }
    }
    const lingua = input.language?.trim().toLowerCase()
    if (lingua && !/^[a-z]{2}(-[a-z]{2})?$/.test(lingua)) {
      throw new Error('La lingua va scritta come codice ISO 639-1, per esempio «it» o «en».')
    }
    const email = input.email?.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('L’email non sembra un indirizzo valido.')
    }

    return {
      kind: 10154,
      content: '',
      tags: [
        ['title', input.title.trim()],
        ['description', input.description.trim()],
        ['image', input.image.trim()],
        ...repeatedTags('website', input.websites ?? []),
        ...categorie.map((c) =>
          c.sotto ? ['category', c.principale, c.sotto] : ['category', c.principale],
        ),
        ...optionalTag('language', lingua),
        ...optionalTag('email', email),
        ...(input.contentWarning !== undefined ? [['content-warning', input.contentWarning]] : []),
        // Il ruolo dichiarato qui non prova nulla da solo: NIP-F4 chiede di
        // riscontrarlo con il kind 10064 pubblicato dall'autore stesso, perche'
        // un podcast puo' attribuirsi chiunque.
        ...(input.authors ?? []).map((a) => (a.role ? ['p', a.pubkey, a.role] : ['p', a.pubkey])),
      ],
      created_at: ctx.now,
    }
  },
})

/**
 * Kind 10064 — i podcast di cui una persona e' autrice (NIP-F4).
 *
 * E' l'altra meta' del cerchio: la scheda del podcast (10154) dice chi sono
 * gli autori con un tag `p`, ma «un podcast puo' attribuirsi chiunque». Il
 * 10064 lo pubblica **l'autore**, sulla sua chiave, e nomina i podcast: solo
 * quando le due dichiarazioni si riscontrano il legame e' credibile.
 *
 * Replaceable: c'e' una lista sola per persona, e ripubblicarla la
 * sostituisce.
 */
export const authoredPodcastsSchema = z.object({
  /** Chiavi dei podcast, in esadecimale. */
  podcasts: z.array(z.string()),
})

export type AuthoredPodcastsParsed = z.infer<typeof authoredPodcastsSchema>

export interface AuthoredPodcastsInput {
  podcasts: string[]
}

export const authoredPodcastsDefinition = defineKind<AuthoredPodcastsParsed, AuthoredPodcastsInput>(
  {
    kind: 10064,
    name: 'podcast-di-cui-sono-autore',
    nip: 'NIP-F4',
    class: 'replaceable',
    editable: true,
    deletable: true,
    schema: authoredPodcastsSchema,
    feed: { eligible: false },
    renderer: 'podcast-authored',

    parse(event) {
      return authoredPodcastsSchema.parse({
        podcasts: tagsNamed(event, 'p')
          .map((t) => t[1])
          .filter((p): p is string => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)),
      })
    },

    build(input, ctx) {
      // Senza doppioni e senza vuoti: una lista che ripete una chiave non dice
      // niente di piu', e una chiave malformata non e' un podcast.
      const podcasts = [...new Set(input.podcasts.map((p) => p.trim().toLowerCase()))].filter((p) =>
        /^[0-9a-f]{64}$/.test(p),
      )
      if (podcasts.length === 0) {
        throw new Error(
          'La lista dei podcast di cui sei autore e’ vuota: per toglierti da tutti, cancella l’evento invece di pubblicarne uno vuoto.',
        )
      }
      return {
        kind: 10064,
        content: '',
        tags: podcasts.map((p) => ['p', p]),
        created_at: ctx.now,
      }
    },
  },
)
