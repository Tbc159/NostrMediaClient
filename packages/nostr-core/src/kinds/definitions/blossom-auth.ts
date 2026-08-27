import { z } from 'zod'

import { defineKind } from '../registry.js'
import { repeatedTags, tagValue, tagValues } from '../tags.js'

/**
 * Kind 24242 — autorizzazione Blossom (BUD-11).
 *
 * **Non viene mai pubblicato su un relay.** E' un evento firmato che viaggia
 * dentro l'header `Authorization` di una richiesta HTTP verso un server
 * Blossom, e serve a dimostrare che chi carica il file possiede la chiave.
 * Sta nella fascia effimera proprio per questo: non ha senso conservarlo.
 *
 * Vincoli della specifica, tutti verificati in costruzione:
 *
 *  - `t` con il verbo dell'operazione (`upload`, `get`, `list`, `delete`, `media`);
 *  - `expiration` (NIP-40) **nel futuro**: un token senza scadenza resterebbe
 *    valido per sempre, e chi lo intercettasse potrebbe riusarlo;
 *  - `x` con l'hash del blob, obbligatorio per l'upload;
 *  - `content` leggibile: e' quello che l'utente vede quando l'estensione gli
 *    chiede di firmare, e scriverci una stringa vuota significa chiedergli di
 *    autorizzare qualcosa che non puo' capire.
 *
 * Il tag `server` limita il token a un dominio. Senza, un token intercettato
 * e' spendibile su qualsiasi server Blossom fino alla scadenza.
 */

export const verbiBlossom = ['get', 'upload', 'list', 'delete', 'media'] as const
export type VerboBlossom = (typeof verbiBlossom)[number]

export const blossomAuthSchema = z.object({
  verb: z.enum(verbiBlossom),
  expiration: z.number().int().positive(),
  hashes: z.array(z.string()),
  servers: z.array(z.string()),
  content: z.string(),
})

export type BlossomAuthParsed = z.infer<typeof blossomAuthSchema>

export interface BlossomAuthInput {
  verb: VerboBlossom
  /** Scadenza assoluta, secondi unix. */
  expiration: number
  /** Hash dei blob a cui il token si applica. */
  hashes?: string[]
  /** Domini a cui limitare il token (solo il nome host, non l'URL). */
  servers?: string[]
  /** Spiegazione mostrata all'utente al momento della firma. */
  content: string
}

export const blossomAuthDefinition = defineKind<BlossomAuthParsed, BlossomAuthInput>({
  kind: 24242,
  name: 'autorizzazione-blossom',
  nip: 'BUD-11',
  class: 'ephemeral',
  editable: false,
  deletable: false, // effimero: non c'e' niente da cancellare
  schema: blossomAuthSchema,
  feed: { eligible: false },

  parse(event) {
    const verb = tagValue(event, 't')
    const scadenza = tagValue(event, 'expiration')
    return blossomAuthSchema.parse({
      verb,
      expiration: scadenza ? Number.parseInt(scadenza, 10) : 0,
      hashes: tagValues(event, 'x'),
      servers: tagValues(event, 'server'),
      content: event.content,
    })
  },

  build(input, ctx) {
    if (input.expiration <= ctx.now) {
      throw new Error('La scadenza del token Blossom deve essere nel futuro (BUD-11).')
    }
    if (input.verb === 'upload' && (input.hashes ?? []).length === 0) {
      throw new Error(
        'Un token di upload deve dichiarare l’hash del file: senza, il server non puo’ legarlo al blob che riceve.',
      )
    }
    if (input.content.trim() === '') {
      throw new Error(
        'Il token deve spiegare a cosa serve: e’ il testo che l’utente vede quando gli si chiede di firmarlo.',
      )
    }
    for (const s of input.servers ?? []) {
      if (s.includes('://') || s.includes('/')) {
        throw new Error(
          `Il tag "server" vuole il solo nome di dominio, non un URL: ricevuto "${s}".`,
        )
      }
    }

    return {
      kind: 24242,
      content: input.content,
      tags: [
        ['t', input.verb],
        ['expiration', String(input.expiration)],
        ...repeatedTags('x', input.hashes ?? []),
        ...repeatedTags('server', input.servers ?? []),
      ],
      created_at: ctx.now,
    }
  },
})
