import type { CifrarioNip44 } from '../identity/cipher.js'
import type { DraftWrapInput, DraftWrapParsed } from '../kinds/definitions/draft.js'
import type { EventTemplate } from '../kinds/types.js'
import { sha256Hex } from '../utils/hash.js'

/**
 * Bozze cifrate (NIP-37): impacchettamento e apertura.
 *
 * Sta fuori dalle definizioni dei kind di proposito: quelle descrivono formati
 * e non possiedono chiavi, mentre qui serve un cifrario, che dipende dalla
 * modalita' di accesso attiva. La separazione fa anche si' che il registry
 * resti utilizzabile lato server, dove nessuna chiave e' disponibile.
 */

/**
 * Identificatore pubblico dell'involucro, ricavato in modo da non dire nulla.
 *
 * Il tag `d` di un evento **non e' cifrato**: e' l'unico modo che il relay ha
 * di sapere quale versione sostituire. Derivarlo dal titolo della bozza —
 * `bozza-cifrata-di-prova` — vanificherebbe meta' del lavoro: il contenuto
 * resterebbe illeggibile, ma chiunque abbia accesso al relay leggerebbe di
 * cosa stai scrivendo.
 *
 * Un hash risolve entrambe le esigenze: e' **deterministico**, quindi
 * risalvare la stessa bozza sostituisce l'involucro invece di affiancarne uno
 * nuovo, ed e' **opaco**, quindi non rivela nulla. Sedici caratteri bastano:
 * la collisione dovrebbe avvenire fra le bozze di una sola persona.
 *
 * L'identificatore vero dell'articolo resta dentro il contenuto cifrato, dove
 * nessun altro lo vede.
 */
export async function draftIdentifier(seme: string): Promise<string> {
  return (await sha256Hex(`nip37:${seme}`)).slice(0, 16)
}

/** Novanta giorni, la durata raccomandata dalla specifica. */
export const SCADENZA_BOZZA_PREDEFINITA = 90 * 24 * 60 * 60

export interface OpzioniBozza {
  /** Scadenza assoluta in secondi unix. `null` per non metterne nessuna. */
  expiration?: number | null
  /** Adesso, in secondi. Iniettabile per rendere i test deterministici. */
  now?: number
}

/**
 * Cifra un evento non firmato e prepara l'input per il kind 31234.
 *
 * L'evento **non va firmato prima**: una bozza e' un lavoro in corso, e
 * firmarla produrrebbe un id e una firma definitivi per un contenuto che
 * cambiera' ancora. La firma la porta l'involucro, non il contenuto.
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
 * Apre una bozza cifrata.
 *
 * Restituisce `null` per una bozza cancellata — la specifica usa un `content`
 * vuoto per dire proprio questo — invece di lanciare: una bozza cancellata e'
 * un esito normale della lettura, non un errore.
 *
 * @throws se il contenuto non si decifra o non e' un evento sensato. Fallire
 *         qui e' giusto: significa che la chiave non e' quella con cui la
 *         bozza e' stata scritta, e proseguire mostrerebbe dati inventati.
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
      'Non e’ stato possibile decifrare la bozza. Di norma significa che e’ stata scritta con un’altra identita’.',
    )
  }

  let contenuto: unknown
  try {
    contenuto = JSON.parse(testo)
  } catch {
    throw new Error('La bozza si e’ decifrata ma non contiene JSON valido.')
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

/** Input per cancellare una bozza: content vuoto, come vuole la specifica. */
export function cancellaBozza(bozza: DraftWrapParsed): DraftWrapInput {
  return { identifier: bozza.identifier, draftKind: bozza.draftKind, ciphertext: '' }
}

// --- Relay privati (kind 10013) ---------------------------------------------

/** Cifra l'elenco dei relay privati per il kind 10013. */
export async function wrapPrivateRelays(
  cifrario: CifrarioNip44,
  relays: readonly string[],
): Promise<string> {
  // La specifica vuole *tag privati*, cioe' la stessa forma dei tag ma dentro
  // il content cifrato: non un semplice array di stringhe.
  return cifrario.encrypt(JSON.stringify(relays.map((url) => ['relay', url])))
}

/** Apre l'elenco dei relay privati. Restituisce `[]` se non si legge. */
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
    // Un elenco illeggibile non deve impedire di salvare bozze: si ripiega
    // sulla configurazione locale, che e' il comportamento gia' previsto.
    return []
  }
}
