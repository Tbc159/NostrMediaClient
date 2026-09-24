import { z } from 'zod'

import { defineKind } from '../registry.js'

/**
 * Kind 0 — profilo utente (NIP-01).
 *
 * Il contenuto e' un oggetto JSON dentro `content`, non nei tag. Nessun campo
 * e' obbligatorio e chiunque puo' aggiungerne di propri, quindi il parsing deve
 * essere tollerante: un profilo malformato non deve impedire di mostrare il
 * resto dell'applicazione.
 *
 * **I campi che non conosciamo si conservano.** Il profilo e' uno solo ed e'
 * sostituibile: salvarlo da qui riscrive quello che c'era. Un client che
 * scrive `pronouns` o `birthday` — campi veri, fuori da NIP-01 — li vedrebbe
 * sparire al primo salvataggio fatto con noi. Lo schema quindi non scarta
 * l'ignoto: lo tiene da parte e lo riscrive com'era. Vale la stessa regola dei
 * tag: cio' che non sappiamo leggere non e' nostro da cancellare.
 */

const profileNoti = z.object({
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

/**
 * Lo schema vero: i campi noti piu' qualunque altro, conservato com'e'.
 *
 * `catchall` e' la differenza fra «leggo il profilo» e «riscrivo il profilo
 * buttando via cio' che non capisco».
 */
export const profileSchema = profileNoti.catchall(z.unknown())

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

    // Un campo noto di tipo sbagliato non deve far perdere tutto il resto: si
    // riprova tenendo solo cio' che e' sopravvissuto, piu' l'ignoto.
    const esito = profileSchema.safeParse(grezzo)
    if (esito.success) return esito.data
    return typeof grezzo === 'object' && grezzo !== null ? { ...(grezzo as Profile) } : {}
  },

  build(input, ctx) {
    // I campi assenti non vanno scritti come null: un client che rilegge il
    // profilo li interpreterebbe come "impostato a niente" invece che "non
    // impostato". I campi altrui passano di qui come gli altri: arrivano da
    // `parse` dentro lo stesso oggetto e tornano nel JSON senza essere letti.
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
