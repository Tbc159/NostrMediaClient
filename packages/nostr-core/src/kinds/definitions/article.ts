import { z } from 'zod'

import { defineKind } from '../registry.js'
import { normalizeHashtag, optionalTag, repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 30023 — articolo long-form (NIP-23).
 *
 * Il `content` e' **Markdown**, con due divieti espliciti nella specifica:
 * niente HTML, e niente a capo forzati a fine riga. Il secondo sembra un
 * dettaglio tipografico e non lo e': un testo mandato a capo a 80 colonne si
 * legge male su un telefono, dove le righe vengono spezzate una seconda volta.
 *
 * E' addressable, quindi **modificabile davvero**: ripubblicare con lo stesso
 * `d` sostituisce la versione precedente. Da qui la distinzione fra due date
 * che e' facile confondere:
 *
 *   - `created_at` e' l'ultima modifica;
 *   - `published_at` e' la prima pubblicazione, e non cambia mai.
 *
 * Se si aggiorna `published_at` a ogni salvataggio, l'articolo risulta
 * ripubblicato da capo ogni volta e scala i feed cronologici altrui senza
 * motivo.
 */

export const articleSchema = z.object({
  /** Corpo dell'articolo, in Markdown. */
  content: z.string(),
  identifier: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  image: z.string().optional(),
  /** Prima pubblicazione, secondi unix. Non cambia con le modifiche. */
  publishedAt: z.number().int().positive().optional(),
  hashtags: z.array(z.string()),
})

export type ArticleParsed = z.infer<typeof articleSchema>

export interface ArticleInput {
  content: string
  identifier: string
  title?: string
  summary?: string
  image?: string
  publishedAt?: number
  hashtags?: string[]
}

/** Identificatore leggibile ricavato dal titolo, per un `d` tag parlante. */
export function slugFromTitle(titolo: string): string {
  const base = titolo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // via gli accenti
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  // Un titolo di soli simboli lascerebbe un identificatore vuoto, che come
  // tag `d` significherebbe "l'articolo senza nome" e collidere con altri.
  return base.length > 0 ? base : `articolo-${Date.now().toString(36)}`
}

function creaDefinizioneArticolo(kind: 30023 | 30024, nome: string) {
  return defineKind<ArticleParsed, ArticleInput>({
    kind,
    name: nome,
    nip: 'NIP-23',
    class: 'addressable',
    editable: true,
    deletable: true,
    schema: articleSchema,
    feed: { eligible: false },
    renderer: 'article',

    identifier: (input) => input.identifier,

    parse(event) {
      const pubblicato = tagValue(event, 'published_at')
      const publishedAt = pubblicato ? Number.parseInt(pubblicato, 10) : undefined
      const opzionali = {
        title: tagValue(event, 'title'),
        summary: tagValue(event, 'summary'),
        image: tagValue(event, 'image'),
        ...(publishedAt !== undefined && Number.isFinite(publishedAt) ? { publishedAt } : {}),
      }

      return articleSchema.parse({
        content: event.content,
        identifier: tagValue(event, 'd') ?? '',
        hashtags: tagValues(event, 't').map(normalizeHashtag),
        ...Object.fromEntries(Object.entries(opzionali).filter(([, v]) => v !== undefined)),
      })
    },

    build(input, ctx) {
      if (input.identifier.trim() === '') {
        throw new Error(
          'Un articolo ha bisogno di un identificatore: e’ il tag `d` che rende la modifica una sostituzione invece di un doppione.',
        )
      }
      if (/<[a-z][\s\S]*>/i.test(input.content)) {
        // NIP-23: «MUST NOT support adding HTML to Markdown».
        throw new Error(
          'NIP-23 non ammette HTML dentro il Markdown: i client che lo renderizzano lo mostrerebbero come testo, quelli che non lo fanno lo eseguirebbero.',
        )
      }

      return {
        kind,
        content: input.content,
        tags: [
          ['d', input.identifier],
          ...optionalTag('title', input.title),
          ...optionalTag('summary', input.summary),
          ...optionalTag('image', input.image),
          // Alla prima pubblicazione coincide con created_at; nelle modifiche
          // successive va passato quello originale, non ricalcolato.
          ['published_at', String(input.publishedAt ?? ctx.now)],
          ...repeatedTags('t', (input.hashtags ?? []).map(normalizeHashtag)),
        ],
        created_at: ctx.now,
      }
    },
  })
}

export const articleDefinition = creaDefinizioneArticolo(30023, 'articolo')

/**
 * Kind 30024 — bozza long-form.
 *
 * **NIP-23 lo dichiara deprecato**: la via consigliata per le bozze e' ora
 * NIP-37 (kind 31234, cifrato NIP-44 verso se stessi). Lo teniamo registrato
 * per *leggere* le bozze che gli utenti hanno gia', non per crearne di nuove.
 *
 * La differenza pratica e' sostanziale: un 30024 e' in chiaro, quindi chiunque
 * abbia accesso al relay lo legge. Chiamarlo "bozza" e' fuorviante — e' un
 * articolo pubblicato in un posto poco frequentato.
 */
export const articleDraftDefinition = creaDefinizioneArticolo(30024, 'bozza-articolo-legacy')
