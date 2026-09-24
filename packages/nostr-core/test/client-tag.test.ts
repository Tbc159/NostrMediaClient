import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { blossomAuthDefinition } from '../src/kinds/definitions/blossom-auth.js'
import { calendarTimeEventDefinition } from '../src/kinds/definitions/calendar-time.js'
import { metadataDefinition } from '../src/kinds/definitions/metadata.js'
import { noteDefinition } from '../src/kinds/definitions/note.js'
import { podcastMetadataDefinition } from '../src/kinds/definitions/podcast.js'
import { NOME_CLIENT, conTagClient } from '../src/kinds/client.js'
import { defineKind } from '../src/kinds/registry.js'
import type { EventTemplate } from '../src/kinds/types.js'

/**
 * Il tag `client` non e' una decorazione: dice a chi legge con cosa e' stato
 * composto l'evento. Sta dentro `defineKind`, quindi la prova che conta e'
 * che nessun kind possa uscire senza — e che l'unico escluso, il token
 * Blossom, resti escluso.
 */

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }
const tagClient = (t: EventTemplate): string[][] => t.tags.filter((x) => x[0] === 'client')

describe('tag client', () => {
  it('lo porta ogni kind che finisce sui relay', () => {
    const casi: EventTemplate[] = [
      metadataDefinition.build({ name: 'prova' }, CTX),
      noteDefinition.build({ content: 'ciao' }, CTX),
      podcastMetadataDefinition.build(
        { title: 'Show', description: 'x', image: 'https://e.tld/c.jpg' },
        CTX,
      ),
      calendarTimeEventDefinition.build(
        { identifier: 'd1', title: 'Incontro', start: 1_800_000_000 },
        CTX,
      ),
    ]
    for (const t of casi) expect(tagClient(t)).toEqual([['client', NOME_CLIENT]])
  })

  it('non lo mette sul token Blossom, che non e’ un evento pubblicato', () => {
    const t = blossomAuthDefinition.build(
      {
        verb: 'upload',
        expiration: CTX.now + 60,
        hashes: ['aa'.repeat(32)],
        content: 'Carica un file su esempio.tld',
      },
      CTX,
    )
    expect(tagClient(t)).toEqual([])
  })

  it('sovrascrive quello di un altro client invece di affiancarlo', () => {
    // E' il caso vero: si riapre un evento di Plektos e lo si ripubblica.
    // L'evento nuovo lo scrive questo programma, e dire il contrario sarebbe
    // falso; due tag `client` lascerebbero chi legge a indovinare.
    const fuso = conTagClient({
      kind: 31923,
      content: '',
      created_at: CTX.now,
      tags: [
        ['d', 'x'],
        ['client', 'Plektos'],
        ['title', 'Meetup'],
      ],
    })
    expect(tagClient(fuso)).toEqual([['client', NOME_CLIENT]])
    expect(fuso.tags.filter((t) => t[0] === 'title')).toHaveLength(1)
  })

  it('e’ idempotente: ricostruire due volte non accumula tag', () => {
    const uno = noteDefinition.build({ content: 'ciao' }, CTX)
    expect(tagClient(conTagClient(uno))).toHaveLength(1)
  })

  it('non muta il template che riceve', () => {
    const originale: EventTemplate = { kind: 1, content: '', created_at: 1, tags: [['t', 'x']] }
    conTagClient(originale)
    expect(originale.tags).toEqual([['t', 'x']])
  })

  it('vale anche per una definizione registrata dopo, senza toccarla', () => {
    // La regola sta in defineKind proprio perche' un kind nuovo la erediti
    // senza che chi lo scrive debba ricordarsene.
    const nuovo = defineKind<{ x: string }, { x: string }>({
      kind: 30078,
      name: 'inventato',
      nip: 'NIP-78',
      class: 'addressable',
      editable: true,
      deletable: true,
      schema: z.object({ x: z.string() }),
      identifier: (i) => i.x,
      parse: () => ({ x: '' }),
      build: (input, ctx) => ({
        kind: 30078,
        content: '',
        tags: [['d', input.x]],
        created_at: ctx.now,
      }),
    })
    expect(tagClient(nuovo.build({ x: 'a' }, CTX))).toEqual([['client', NOME_CLIENT]])
  })
})
