import { z } from 'zod'

import { defineKind } from '../registry.js'
import { tagsNamed } from '../tags.js'

/**
 * Kind 10063 — the Blossom servers a key uploads to (BUD-03).
 *
 * One `server` tag per server, most trusted first: the first is where a
 * client uploads, the others where it mirrors — and where anyone looks for a
 * file whose server has gone away, by its hash. NMC reads it at login, so that
 * a new device uploads where the others do, and writes it when the user asks.
 */

export const blossomServersSchema = z.object({
  server: z.array(z.string()),
})

export type BlossomServersParsed = z.infer<typeof blossomServersSchema>

export interface BlossomServersInput {
  server: string[]
}

const URL_SERVER = /^https?:\/\/[^\s/]+/i

export const blossomServersDefinition = defineKind<BlossomServersParsed, BlossomServersInput>({
  kind: 10063,
  name: 'server-blossom',
  nip: 'BUD-03',
  class: 'replaceable',
  editable: true,
  deletable: true,
  schema: blossomServersSchema,
  feed: { eligible: false },

  parse(event) {
    const visti = new Set<string>()
    const server: string[] = []
    for (const t of tagsNamed(event, 'server')) {
      const url = typeof t[1] === 'string' ? t[1].trim().replace(/\/+$/, '') : ''
      if (!URL_SERVER.test(url) || visti.has(url)) continue
      visti.add(url)
      server.push(url)
    }
    return blossomServersSchema.parse({ server })
  },

  build(input, ctx) {
    // The order is the meaning: the first server is the primary one.
    const server: string[] = []
    for (const grezzo of input.server) {
      const url = grezzo.trim().replace(/\/+$/, '')
      if (!URL_SERVER.test(url)) {
        throw new Error(`«${grezzo}» non è l’indirizzo di un server (https://…).`)
      }
      if (!server.includes(url)) server.push(url)
    }
    if (server.length === 0) {
      throw new Error(
        'Una lista vuota direbbe agli altri client che non carichi file da nessuna parte.',
      )
    }
    return {
      kind: 10063,
      content: '',
      tags: server.map((url) => ['server', url]),
      created_at: ctx.now,
    }
  },
})
