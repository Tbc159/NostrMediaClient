import { z } from 'zod'

import { defineKind } from '../registry.js'
import { optionalTag, tagValue } from '../tags.js'

/**
 * Kind 31234 — bozza cifrata (NIP-37).
 *
 * Contiene un evento **non firmato** di un altro kind, serializzato e cifrato
 * NIP-44 verso la propria stessa chiave. Sostituisce il kind 30024, che NIP-23
 * dichiara deprecato: quello finiva sul relay *in chiaro*, e chiamarlo bozza
 * era fuorviante.
 *
 * Nota di progetto: questa definizione **non cifra e non decifra**. Il
 * `content` per lei e' una stringa opaca, e ci sono due motivi:
 *
 *   1. `build()` e' sincrona per contratto, mentre con NIP-07 la cifratura
 *      avviene dentro l'estensione e restituisce una `Promise`;
 *   2. il registry descrive *formati*, non possiede chiavi. Farci passare
 *      materiale crittografico lo legherebbe alla modalita' di accesso attiva.
 *
 * La cifratura sta in `wrapDraft`/`unwrapDraft`, che ricevono un cifrario.
 *
 * **Un `content` vuoto significa bozza cancellata**, non bozza vuota: lo dice
 * la specifica, ed e' l'unico modo di cancellarne una senza sperare che il
 * relay onori una richiesta kind 5.
 */

export const draftWrapSchema = z.object({
  identifier: z.string(),
  /** Kind dell'evento contenuto, dal tag `k`. */
  draftKind: z.number().int().nonnegative(),
  /** Contenuto cifrato. Vuoto se la bozza e' stata cancellata. */
  ciphertext: z.string(),
  /** Scadenza NIP-40, secondi unix. */
  expiration: z.number().int().positive().optional(),
  /** Vero quando il content e' vuoto, cioe' quando la bozza e' stata cancellata. */
  cancellata: z.boolean(),
})

export type DraftWrapParsed = z.infer<typeof draftWrapSchema>

export interface DraftWrapInput {
  identifier: string
  draftKind: number
  /** Gia' cifrato. Stringa vuota per cancellare la bozza. */
  ciphertext: string
  expiration?: number
}

export const draftWrapDefinition = defineKind<DraftWrapParsed, DraftWrapInput>({
  kind: 31234,
  name: 'bozza-cifrata',
  nip: 'NIP-37',
  class: 'addressable',
  editable: true,
  deletable: true,
  schema: draftWrapSchema,
  feed: { eligible: false },
  renderer: 'draft',

  identifier: (input) => input.identifier,

  parse(event) {
    const d = tagValue(event, 'd')
    if (d === undefined) throw new Error(`kind 31234 senza tag "d": evento ${event.id}`)

    const k = tagValue(event, 'k')
    if (k === undefined) {
      throw new Error(`kind 31234 senza tag "k", che NIP-37 richiede: evento ${event.id}`)
    }
    const draftKind = Number.parseInt(k, 10)
    if (!Number.isFinite(draftKind) || draftKind < 0) {
      throw new Error(`kind 31234 con tag "k" non numerico ("${k}"): evento ${event.id}`)
    }

    const scadenza = tagValue(event, 'expiration')
    const expiration = scadenza ? Number.parseInt(scadenza, 10) : undefined

    return draftWrapSchema.parse({
      identifier: d,
      draftKind,
      ciphertext: event.content,
      ...(expiration !== undefined && Number.isFinite(expiration) && expiration > 0
        ? { expiration }
        : {}),
      cancellata: event.content.trim() === '',
    })
  },

  build(input, ctx) {
    if (input.identifier.trim() === '') {
      throw new Error(
        'Una bozza ha bisogno di un identificatore: e’ il tag `d` che la rende sostituibile.',
      )
    }
    if (input.draftKind === 31234) {
      // Una bozza di bozza non ha senso e produrrebbe un annidamento infinito.
      throw new Error('Il tag `k` deve indicare il kind dell’evento in bozza, non 31234.')
    }

    return {
      kind: 31234,
      content: input.ciphertext,
      tags: [
        ['d', input.identifier],
        ['k', String(input.draftKind)],
        ...optionalTag(
          'expiration',
          input.expiration !== undefined ? String(input.expiration) : undefined,
        ),
      ],
      created_at: ctx.now,
    }
  },
})

/**
 * Kind 10013 — relay per i contenuti privati (NIP-37).
 *
 * L'elenco dei relay sta **cifrato nel content**, non nei tag: i tag di un
 * evento sono pubblici, e sapere su quali relay una persona tiene le proprie
 * bozze e' gia' un'informazione.
 *
 * Come per il 31234, qui il content resta opaco: la cifratura passa da
 * `wrapPrivateRelays`.
 */
export const privateRelaysSchema = z.object({
  ciphertext: z.string(),
})

export type PrivateRelaysParsed = z.infer<typeof privateRelaysSchema>

export interface PrivateRelaysInput {
  /** Gia' cifrato. */
  ciphertext: string
}

export const privateRelaysDefinition = defineKind<PrivateRelaysParsed, PrivateRelaysInput>({
  kind: 10013,
  name: 'relay-privati',
  nip: 'NIP-37',
  class: 'replaceable',
  editable: true,
  deletable: true,
  schema: privateRelaysSchema,
  feed: { eligible: false },

  parse(event) {
    return privateRelaysSchema.parse({ ciphertext: event.content })
  },

  build(input, ctx) {
    return {
      kind: 10013,
      content: input.ciphertext,
      tags: [],
      created_at: ctx.now,
    }
  },
})
