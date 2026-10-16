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
 * The `client` tag is not a decoration: it tells the reader what the event was
 * composed with. It lives inside `defineKind`, so the check that counts is that
 * no kind can come out without it — and that the only one excluded, the Blossom
 * token, stays excluded.
 */

const CTX = { pubkey: 'ab'.repeat(32), now: 1_800_000_000 }
const tagClient = (t: EventTemplate): string[][] => t.tags.filter((x) => x[0] === 'client')

describe('the client tag', () => {
  it('is carried by every kind that ends up on the relays', () => {
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

  it('is not put on the Blossom token, which is not a published event', () => {
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

  it("overwrites another client's instead of sitting beside it", () => {
    // It is the real case: a Plektos event is reopened and republished. The
    // new event is written by this program, and saying otherwise would be
    // false; two `client` tags would leave the reader guessing.
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

  it('is idempotent: building twice does not pile up tags', () => {
    const uno = noteDefinition.build({ content: 'ciao' }, CTX)
    expect(tagClient(conTagClient(uno))).toHaveLength(1)
  })

  it('does not mutate the template it receives', () => {
    const originale: EventTemplate = { kind: 1, content: '', created_at: 1, tags: [['t', 'x']] }
    conTagClient(originale)
    expect(originale.tags).toEqual([['t', 'x']])
  })

  it('holds for a definition registered later too, without touching it', () => {
    // The rule lives in defineKind precisely so a new kind inherits it
    // without whoever writes it having to remember.
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
