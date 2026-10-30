import type { CifrarioNip44 } from '../identity/cipher.js'
import type { DraftWrapInput, DraftWrapParsed } from '../kinds/definitions/draft.js'
import type { EventTemplate } from '../kinds/types.js'
import { sha256Hex } from '../utils/hash.js'

/**
 * Encrypted drafts (NIP-37): wrapping and opening.
 *
 * It lives outside the kind definitions on purpose: those describe formats
 * and own no keys, while here a cipher is needed, and that depends on the
 * active sign-in mode. The separation also keeps the registry usable
 * server-side, where no key is available.
 *
 * The error messages stay in Italian: they are shown to whoever is reopening
 * a draft, and the interface is Italian.
 */

/**
 * The wrapper's public identifier, derived so as to say nothing.
 *
 * An event's `d` tag is **not encrypted**: it is the only way the relay has
 * of knowing which version to replace. Deriving it from the draft's title —
 * `bozza-cifrata-di-prova` — would defeat half the work: the content would
 * stay unreadable, but anyone with access to the relay would read what you
 * are writing about.
 *
 * A hash satisfies both needs: it is **deterministic**, so saving the same
 * draft again replaces the wrapper instead of adding another one next to it,
 * and it is **opaque**, so it reveals nothing. Sixteen characters are enough:
 * a collision would have to happen between one person's own drafts.
 *
 * The article's real identifier stays inside the encrypted content, where
 * nobody else sees it.
 */
export async function draftIdentifier(seme: string): Promise<string> {
  return (await sha256Hex(`nip37:${seme}`)).slice(0, 16)
}

/** Ninety days, the duration the specification recommends. */
export const SCADENZA_BOZZA_PREDEFINITA = 90 * 24 * 60 * 60

export interface OpzioniBozza {
  /** Absolute expiry in unix seconds. `null` for none at all. */
  expiration?: number | null
  /** Now, in seconds. Injectable so tests stay deterministic. */
  now?: number
}

/**
 * Encrypts an unsigned event and prepares the input for kind 31234.
 *
 * The event **must not be signed first**: a draft is work in progress, and
 * signing it would produce a final id and signature for content that will
 * change again. The signature is carried by the wrapper, not by the content.
 */
export async function wrapDraft(
  cifrario: CifrarioNip44,
  identificatore: string,
  bozza: EventTemplate,
  opzioni: OpzioniBozza = {},
): Promise<DraftWrapInput> {
  const adesso = opzioni.now ?? Math.floor(Date.now() / 1000)
  const ciphertext = await cifrario.encrypt(JSON.stringify(bozza))

  const scadenza =
    opzioni.expiration === null
      ? undefined
      : (opzioni.expiration ?? adesso + SCADENZA_BOZZA_PREDEFINITA)

  return {
    identifier: identificatore,
    draftKind: bozza.kind,
    ciphertext,
    ...(scadenza !== undefined ? { expiration: scadenza } : {}),
  }
}

/**
 * Opens an encrypted draft.
 *
 * It returns `null` for a deleted draft — the specification uses an empty
 * `content` to mean exactly that — instead of throwing: a deleted draft is a
 * normal outcome of reading, not an error.
 *
 * @throws if the content does not decrypt or is not a sensible event.
 *         Failing here is right: it means the key is not the one the draft
 *         was written with, and carrying on would show invented data.
 */
export async function unwrapDraft(
  cifrario: CifrarioNip44,
  bozza: DraftWrapParsed,
): Promise<EventTemplate | null> {
  if (bozza.cancellata) return null

  let testo: string
  try {
    testo = await cifrario.decrypt(bozza.ciphertext)
  } catch {
    throw new Error(
      'Non è stato possibile decifrare la bozza. Di norma significa che è stata scritta con un’altra identità.',
    )
  }

  let contenuto: unknown
  try {
    contenuto = JSON.parse(testo)
  } catch {
    throw new Error('La bozza si è decifrata ma non contiene JSON valido.')
  }

  if (
    typeof contenuto !== 'object' ||
    contenuto === null ||
    typeof (contenuto as EventTemplate).kind !== 'number'
  ) {
    throw new Error('La bozza non contiene un evento riconoscibile.')
  }

  const evento = contenuto as EventTemplate
  return {
    kind: evento.kind,
    content: typeof evento.content === 'string' ? evento.content : '',
    tags: Array.isArray(evento.tags) ? evento.tags.map((t) => [...t]) : [],
    created_at: typeof evento.created_at === 'number' ? evento.created_at : 0,
  }
}

/** The input to delete a draft: an empty content, as the specification wants. */
export function cancellaBozza(bozza: DraftWrapParsed): DraftWrapInput {
  return { identifier: bozza.identifier, draftKind: bozza.draftKind, ciphertext: '' }
}

// --- Private relays (kind 10013) --------------------------------------------

/** Encrypts the list of private relays for kind 10013. */
export async function wrapPrivateRelays(
  cifrario: CifrarioNip44,
  relays: readonly string[],
): Promise<string> {
  // The specification wants *private tags*, that is the same shape as tags
  // but inside the encrypted content: not a plain array of strings.
  return cifrario.encrypt(JSON.stringify(relays.map((url) => ['relay', url])))
}

/** Opens the list of private relays. Returns `[]` when it cannot be read. */
export async function unwrapPrivateRelays(
  cifrario: CifrarioNip44,
  ciphertext: string,
): Promise<string[]> {
  if (ciphertext.trim() === '') return []
  try {
    const tag = JSON.parse(await cifrario.decrypt(ciphertext)) as unknown
    if (!Array.isArray(tag)) return []
    return tag
      .filter(
        (t): t is string[] => Array.isArray(t) && t[0] === 'relay' && typeof t[1] === 'string',
      )
      .map((t) => t[1] as string)
  } catch {
    // An unreadable list must not stop drafts from being saved: it falls back
    // to the local configuration, which is the behaviour already intended.
    return []
  }
}
