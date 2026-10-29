import { z } from 'zod'

import { tagsNamed, type Tag } from './tags.js'
import type { NostrEvent } from './types.js'

/**
 * The Podcasting 2.0 data a podcast carries beyond NIP-F4, shared by the
 * episode (kind 54) and the show's card (kind 10154).
 *
 * NIP-F4 has no field for them, but a podcast that moves to NMC from another
 * host already has them, and losing them on the way has a cost the creator
 * pays: `value` is what tells Fountain and the other Lightning players whom to
 * send a boost to. They are written as positional tags mirroring the attributes
 * of the RSS elements, so the feed service can render them back one to one.
 * These tags are our convention, documented in `docs/PODCAST.md`.
 */

// ── value: the Lightning split (podcast:value) ─────────────────────────────

export const destinatarioValoreSchema = z.object({
  nome: z.string(),
  /** `node`, `lnaddress`… as in podcast:valueRecipient. */
  tipo: z.string(),
  indirizzo: z.string(),
  /** A share, not a percentage: the shares are proportions of their total. */
  quota: z.number().int().positive(),
  customKey: z.string().optional(),
  customValue: z.string().optional(),
  /** A fee recipient: taken off the top before the split. Hosts often add themselves this way. */
  fee: z.boolean(),
})

export const valoreSchema = z.object({
  /** `lightning`, in practice. */
  tipo: z.string(),
  /** `keysend`, `lnaddress`… */
  metodo: z.string(),
  suggerito: z.string().optional(),
  destinatari: z.array(destinatarioValoreSchema).min(1),
})

export type DestinatarioValore = z.infer<typeof destinatarioValoreSchema>
export type Valore = z.infer<typeof valoreSchema>

/** Drops the empty values at the end of a positional tag. */
function senzaCodaVuota(tag: string[]): Tag {
  const fuori = [...tag]
  while (fuori.length > 2 && (fuori[fuori.length - 1] ?? '') === '') fuori.pop()
  return fuori
}

/** The `value` and `value-recipient` tags; none when there is no split. */
export function tagValore(valore: Valore | undefined): Tag[] {
  if (!valore) return []
  if (valore.destinatari.length === 0) {
    throw new Error('Una ripartizione Lightning ha bisogno di almeno un destinatario.')
  }
  for (const d of valore.destinatari) {
    if (d.indirizzo.trim() === '') {
      throw new Error(`Il destinatario «${d.nome || '(senza nome)'}» non ha un indirizzo.`)
    }
    if (!Number.isInteger(d.quota) || d.quota <= 0) {
      throw new Error(
        `La quota di «${d.nome || d.indirizzo}» deve essere un numero intero positivo: ricevuto ${d.quota}.`,
      )
    }
  }
  return [
    senzaCodaVuota(['value', valore.tipo, valore.metodo, valore.suggerito ?? '']),
    ...valore.destinatari.map((d) =>
      senzaCodaVuota([
        'value-recipient',
        d.nome.trim(),
        d.tipo.trim(),
        d.indirizzo.trim(),
        String(d.quota),
        d.customKey ?? '',
        d.customValue ?? '',
        d.fee ? 'true' : '',
      ]),
    ),
  ]
}

/** The split an event declares, or `undefined` when it declares none. */
export function leggiValore(event: NostrEvent): Valore | undefined {
  const testa = tagsNamed(event, 'value')[0]
  if (!testa?.[1] || !testa[2]) return undefined
  const destinatari = tagsNamed(event, 'value-recipient').flatMap((t): DestinatarioValore[] => {
    const quota = Number(t[4])
    if (!t[3] || !Number.isInteger(quota) || quota <= 0) return []
    return [
      {
        nome: t[1] ?? '',
        tipo: t[2] ?? '',
        indirizzo: t[3],
        quota,
        ...(t[5] ? { customKey: t[5] } : {}),
        ...(t[6] ? { customValue: t[6] } : {}),
        fee: t[7] === 'true',
      },
    ]
  })
  if (destinatari.length === 0) return undefined
  return {
    tipo: testa[1],
    metodo: testa[2],
    ...(testa[3] ? { suggerito: testa[3] } : {}),
    destinatari,
  }
}

// ── person (podcast:person) ────────────────────────────────────────────────

export const personaSchema = z.object({
  nome: z.string(),
  /** `host`, `guest`… from the Podcasting 2.0 taxonomy. */
  ruolo: z.string().optional(),
  gruppo: z.string().optional(),
  immagine: z.string().optional(),
  link: z.string().optional(),
})

export type Persona = z.infer<typeof personaSchema>

export function tagPersone(persone: readonly Persona[] | undefined): Tag[] {
  return (persone ?? [])
    .filter((p) => p.nome.trim() !== '')
    .map((p) =>
      senzaCodaVuota([
        'person',
        p.nome.trim(),
        p.ruolo ?? '',
        p.gruppo ?? '',
        p.immagine ?? '',
        p.link ?? '',
      ]),
    )
}

export function leggiPersone(event: NostrEvent): Persona[] {
  return tagsNamed(event, 'person')
    .filter((t) => typeof t[1] === 'string' && t[1] !== '')
    .map((t) => ({
      nome: t[1] as string,
      ...(t[2] ? { ruolo: t[2] } : {}),
      ...(t[3] ? { gruppo: t[3] } : {}),
      ...(t[4] ? { immagine: t[4] } : {}),
      ...(t[5] ? { link: t[5] } : {}),
    }))
}
