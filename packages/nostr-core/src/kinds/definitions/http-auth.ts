import { z } from 'zod'

import { sha256Hex } from '../../utils/hash.js'
import { defineKind } from '../registry.js'
import { tagValue } from '../tags.js'
import type { EventTemplate, NostrEvent } from '../types.js'

/**
 * Kind 27235 — an HTTP request signed by a key (NIP-98).
 *
 * Like Blossom's 24242, **it is never published to a relay**: it travels in the
 * `Authorization` header of one request and proves the request comes from the
 * key that signed it. That is how the feed service will know, with no account
 * and no password, that `mariarossi` belongs to a podcast's key: the request
 * that claims it is signed by that key.
 *
 * Ephemeral, hence without the `client` tag (see `defineKind`). NIP-98 asks the
 * server to check that `u` is exactly the URL called, `method` the method used,
 * and `created_at` within a short window; when there is a body, `payload`
 * carries its SHA-256 so the token cannot be replayed with another body.
 */

const METODI = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export const httpAuthSchema = z.object({
  url: z.string(),
  metodo: z.string(),
  payload: z.string().optional(),
})

export type HttpAuthParsed = z.infer<typeof httpAuthSchema>

export interface HttpAuthInput {
  /** The absolute URL of the request, query string included. */
  url: string
  metodo: string
  /** The SHA-256 of the body, in hex, when the request has one. */
  payload?: string
}

export const httpAuthDefinition = defineKind<HttpAuthParsed, HttpAuthInput>({
  kind: 27235,
  name: 'autorizzazione-http',
  nip: 'NIP-98',
  class: 'ephemeral',
  editable: false,
  deletable: false, // ephemeral: there is nothing to delete
  schema: httpAuthSchema,
  feed: { eligible: false },

  parse(event) {
    const payload = tagValue(event, 'payload')
    return httpAuthSchema.parse({
      url: tagValue(event, 'u'),
      metodo: tagValue(event, 'method'),
      ...(payload ? { payload } : {}),
    })
  },

  build(input, ctx) {
    let url: URL
    try {
      url = new URL(input.url.trim())
    } catch {
      throw new Error(
        `L’autorizzazione NIP-98 vuole l’URL completo della richiesta: «${input.url}».`,
      )
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('L’autorizzazione NIP-98 vale solo per richieste http(s).')
    }
    const metodo = input.metodo.trim().toUpperCase()
    if (!(METODI as readonly string[]).includes(metodo)) {
      throw new Error(`Metodo HTTP non ammesso: «${input.metodo}».`)
    }
    const payload = input.payload?.trim().toLowerCase()
    if (payload !== undefined && !/^[0-9a-f]{64}$/.test(payload)) {
      throw new Error('Il payload NIP-98 è lo SHA-256 del corpo, in esadecimale.')
    }
    return {
      kind: 27235,
      content: '',
      tags: [['u', url.toString()], ['method', metodo], ...(payload ? [['payload', payload]] : [])],
      created_at: ctx.now,
    }
  },
})

/** Base64 of the UTF-8 bytes: NIP-98 wants plain base64, padding included. */
function base64(testo: string): string {
  let binario = ''
  for (const b of new TextEncoder().encode(testo)) binario += String.fromCharCode(b)
  return btoa(binario)
}

/** The `Authorization` header that carries a signed 27235. */
export function intestazioneNip98(evento: NostrEvent): string {
  return `Nostr ${base64(JSON.stringify(evento))}`
}

/**
 * Signs one request: the header to send with it.
 *
 * @param corpo the exact body that will be sent, when there is one: its hash
 *              goes in `payload`, so the server can tell it was not swapped.
 */
export async function autorizzaRichiesta(
  firma: (template: EventTemplate) => Promise<NostrEvent>,
  pubkey: string,
  richiesta: { url: string; metodo: string; corpo?: string },
): Promise<string> {
  const payload = richiesta.corpo !== undefined ? await sha256Hex(richiesta.corpo) : undefined
  const template = httpAuthDefinition.build(
    { url: richiesta.url, metodo: richiesta.metodo, ...(payload ? { payload } : {}) },
    { pubkey, now: Math.floor(Date.now() / 1000) },
  )
  return intestazioneNip98(await firma(template))
}
