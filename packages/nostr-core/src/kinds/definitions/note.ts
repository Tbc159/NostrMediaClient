import { z } from 'zod'

import { buildImetaTag, imetaOf, imetaSchema, type ImetaInput } from '../imeta.js'
import { defineKind } from '../registry.js'
import { normalizeHashtag, repeatedTags, tagValues, tagsNamed } from '../tags.js'
import type { NostrEvent } from '../types.js'

/**
 * Kind 1 — nota di testo breve (NIP-10).
 *
 * E' un evento *regolare*, quindi immutabile: non esiste modifica. L'unica via
 * per correggere una nota e' chiederne la cancellazione (kind 5) e
 * ripubblicarla, ottenendo pero' un id nuovo e perdendo reazioni e risposte.
 * La UI deve dirlo, non simulare una modifica che il protocollo non offre.
 */

export const noteParsedSchema = z.object({
  content: z.string(),
  /** Id dell'evento radice del thread, se la nota e' una risposta. */
  rootId: z.string().optional(),
  /** Id dell'evento a cui si risponde direttamente. */
  replyToId: z.string().optional(),
  /** Pubkey menzionate (tag `p`). */
  mentions: z.array(z.string()),
  /** Eventi citati (tag `q`, NIP-18). */
  quotes: z.array(z.string()),
  /** Hashtag (tag `t`), gia' normalizzati. */
  hashtags: z.array(z.string()),
  /** Allegati dichiarati con `imeta` (NIP-92). */
  attachments: z.array(imetaSchema),
})

export type NoteParsed = z.infer<typeof noteParsedSchema>

export interface NoteInput {
  content: string
  /**
   * Nota a cui si sta rispondendo. Serve l'evento intero, non solo l'id:
   * NIP-10 vuole che la risposta riporti la radice del thread, che si ricava
   * dai tag della nota a cui si risponde.
   */
  replyTo?: NoteReplyTarget
  /** Evento citato (tag `q`). */
  quoteId?: string
  /** Hashtag, con o senza cancelletto: vengono normalizzati. */
  hashtags?: string[]
  /** Pubkey da menzionare oltre a quelle ereditate dal thread. */
  mentions?: string[]
  /**
   * Allegati (NIP-92).
   *
   * Una nota con un allegato e' l'unico modo di pubblicare un file che
   * *qualunque* client sociale mostra: i kind media dedicati (20, 21, 22) sono
   * piu' precisi ma vengono letti solo da chi li filtra.
   */
  attachments?: ImetaInput[]
}

export interface NoteReplyTarget {
  id: string
  pubkey: string
  /** Radice del thread a cui appartiene, se gia' nota. */
  rootId?: string
  /** Pubkey gia' coinvolte nel thread, da riportare nella risposta. */
  participants?: string[]
}

/**
 * Estrae radice e destinatario da un evento secondo NIP-10.
 *
 * Il NIP prevede tag `e` marcati (`root` / `reply`), ma esiste una montagna di
 * eventi vecchi con tag non marcati, dove la convenzione era: primo `e` =
 * radice, ultimo `e` = risposta diretta. Gestiamo entrambe le forme, altrimenti
 * i thread storici risultano spezzati.
 */
function extractThread(event: NostrEvent): { rootId?: string; replyToId?: string } {
  const eTags = tagsNamed(event, 'e')
  if (eTags.length === 0) return {}

  // Con exactOptionalPropertyTypes una proprieta' presente ma undefined non
  // equivale a una proprieta' assente: le chiavi si aggiungono solo se hanno
  // davvero un valore.
  const componi = (
    rootId?: string,
    replyToId?: string,
  ): { rootId?: string; replyToId?: string } => ({
    ...(rootId !== undefined ? { rootId } : {}),
    ...(replyToId !== undefined ? { replyToId } : {}),
  })

  const marcato = (marker: string): string | undefined => eTags.find((t) => t[3] === marker)?.[1]

  const root = marcato('root')
  const reply = marcato('reply')
  if (root !== undefined || reply !== undefined) {
    // Una risposta diretta alla radice porta solo il marcatore "root".
    return componi(root, reply ?? root)
  }

  const primo = eTags[0]?.[1]
  const ultimo = eTags[eTags.length - 1]?.[1]
  if (eTags.length === 1) return componi(primo, primo)
  return componi(primo, ultimo)
}

export const noteDefinition = defineKind<NoteParsed, NoteInput>({
  kind: 1,
  name: 'nota',
  nip: 'NIP-10',
  class: 'regular',
  editable: false, // immutabile per costruzione: vedi il commento in testa
  deletable: true,
  schema: noteParsedSchema,
  feed: { eligible: true },
  renderer: 'note',

  parse(event) {
    const { rootId, replyToId } = extractThread(event)
    return noteParsedSchema.parse({
      content: event.content,
      ...(rootId !== undefined ? { rootId } : {}),
      ...(replyToId !== undefined ? { replyToId } : {}),
      mentions: tagValues(event, 'p'),
      quotes: tagValues(event, 'q'),
      hashtags: tagValues(event, 't').map(normalizeHashtag),
      attachments: imetaOf(event),
    })
  },

  build(input, ctx) {
    const tags: string[][] = []

    if (input.replyTo) {
      const { id, pubkey, rootId, participants = [] } = input.replyTo

      if (rootId && rootId !== id) {
        // Risposta dentro un thread: si marcano sia la radice sia il padre.
        tags.push(['e', rootId, '', 'root'])
        tags.push(['e', id, '', 'reply'])
      } else {
        // Risposta diretta alla radice: un solo tag, marcato "root".
        tags.push(['e', id, '', 'root'])
      }

      // NIP-10: la risposta riporta gli autori del thread, cosi' ricevono la
      // notifica. Deduplicato da repeatedTags.
      tags.push(...repeatedTags('p', [pubkey, ...participants, ...(input.mentions ?? [])]))
    } else if (input.mentions?.length) {
      tags.push(...repeatedTags('p', input.mentions))
    }

    if (input.quoteId) tags.push(['q', input.quoteId])

    /*
     * NIP-92: «Each imeta tag SHOULD match a URL in the event content».
     * Un allegato dichiarato solo nel tag non verrebbe mostrato da nessuno: i
     * client cercano l'URL nel testo e lo sostituiscono con l'anteprima. Le
     * url mancanti si aggiungono in coda invece di lasciare la nota muta.
     */
    let contenuto = input.content
    for (const allegato of input.attachments ?? []) {
      tags.push(buildImetaTag(allegato))
      if (!contenuto.includes(allegato.url)) {
        contenuto = contenuto.trim() === '' ? allegato.url : `${contenuto}\n\n${allegato.url}`
      }
    }

    if (input.hashtags?.length) {
      tags.push(...repeatedTags('t', input.hashtags.map(normalizeHashtag)))
    }

    return {
      kind: 1,
      content: contenuto,
      tags,
      created_at: ctx.now,
    }
  },
})
