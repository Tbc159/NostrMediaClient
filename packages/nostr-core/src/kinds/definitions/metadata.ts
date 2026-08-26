import { z } from 'zod'

import { defineKind } from '../registry.js'

/**
 * Kind 0 — profilo utente (NIP-01).
 *
 * Il contenuto e' un oggetto JSON dentro `content`, non nei tag. Nessun campo
 * e' obbligatorio e chiunque puo' aggiungerne di propri, quindi il parsing deve
 * essere tollerante: un profilo malformato non deve impedire di mostrare il
 * resto dell'applicazione.
 */

export const profileSchema = z.object({
  name: z.string().optional(),
  display_name: z.string().optional(),
  about: z.string().optional(),
  picture: z.string().optional(),
  banner: z.string().optional(),
  website: z.string().optional(),
  /** Identificatore NIP-05, es. `nome@dominio.tld`. */
  nip05: z.string().optional(),
  /** Indirizzo Lightning per gli zap (NIP-57). */
  lud16: z.string().optional(),
  lud06: z.string().optional(),
  /** Il profilo dichiara di essere un bot. */
  bot: z.boolean().optional(),
})

export type Profile = z.infer<typeof profileSchema>

export const metadataDefinition = defineKind<Profile, Profile>({
  kind: 0,
  name: 'profilo',
  nip: 'NIP-01',
  class: 'replaceable',
  editable: true,
  deletable: false, // cancellare il proprio profilo non e' un'operazione sensata
  schema: profileSchema,
  feed: { eligible: false },
  renderer: 'profile',

  parse(event) {
    let grezzo: unknown
    try {
      grezzo = JSON.parse(event.content)
    } catch {
      throw new Error(`profilo con content non JSON: evento ${event.id}`)
    }

    // `catchall` implicito: i campi sconosciuti vengono scartati invece di far
    // fallire il parsing. Molti client scrivono estensioni proprie nel kind 0.
    const esito = profileSchema.safeParse(grezzo)
    return esito.success ? esito.data : {}
  },

  build(input, ctx) {
    // I campi assenti non vanno scritti come null: un client che rilegge il
    // profilo li interpreterebbe come "impostato a niente" invece che "non
    // impostato".
    const pulito = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
    )

    return {
      kind: 0,
      content: JSON.stringify(pulito),
      tags: [],
      created_at: ctx.now,
    }
  },
})

/** Nome da mostrare, con i vari ripieghi in ordine di preferenza. */
export function displayName(profile: Profile | undefined, pubkey: string): string {
  return (
    profile?.display_name?.trim() ||
    profile?.name?.trim() ||
    `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
  )
}
