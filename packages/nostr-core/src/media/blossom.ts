import { blossomAuthDefinition, type VerboBlossom } from '../kinds/definitions/blossom-auth.js'
import type { EventTemplate, NostrEvent } from '../kinds/types.js'
import { sha256Hex } from '../utils/hash.js'
import { urlConEstensione } from './extensions.js'

/**
 * The Blossom client (BUD-01/02/04/11).
 *
 * Blossom identifies files by **hash**, not by name or path: the same file
 * uploaded to ten servers has the same identifier everywhere. This changes the
 * mental model compared with ordinary storage — you do not "upload into a
 * folder", you "make a blob available" — and it makes redundancy free:
 * mirroring means telling a second server to go and fetch the same hash.
 *
 * The hash is also what ties the upload to the Nostr event: the imeta's `x`
 * tag is that same hash, so whoever reads the event can verify that the file
 * they downloaded is exactly the one the author published.
 */

/** The descriptor the server returns after a successful upload (BUD-02). */
export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type: string
  uploaded: number
}

/** Signs a template. The key never passes through here. */
export type FirmaEvento = (template: EventTemplate) => Promise<NostrEvent> | NostrEvent

export class BlossomError extends Error {
  constructor(
    message: string,
    readonly stato: number,
    readonly server: string,
    /** The content of the `X-Reason` header, when the server exposed it. */
    readonly ragione?: string,
  ) {
    super(message)
    this.name = 'BlossomError'
  }
}

export { sha256Hex }

/**
 * Encodes the token for the `Authorization` header.
 *
 * Base64**url** without padding, like JWTs: the standard variant uses `+` and
 * `/`, which inside an HTTP header run into over-zealous proxies and parsers.
 * Going through TextEncoder is necessary because the token's `content` is
 * readable text and can contain accents, which `btoa` alone cannot take.
 */
export function encodeAuthHeader(evento: NostrEvent): string {
  const byte = new TextEncoder().encode(JSON.stringify(evento))
  let binario = ''
  for (const b of byte) binario += String.fromCharCode(b)
  const base64 = btoa(binario)
  return `Nostr ${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** The host name alone, which is what BUD-11 wants in the `server` tag. */
export function hostDi(server: string): string {
  try {
    return new URL(server).hostname.toLowerCase()
  } catch {
    return (
      server
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.toLowerCase() ?? server
    )
  }
}

export interface OpzioniAutorizzazione {
  verbo: VerboBlossom
  hashes?: string[]
  server?: string
  /** The token's validity in seconds. The default: 5 minutes. */
  validitaSecondi?: number
  /** The text shown to the user at signing time. */
  descrizione: string
}

/**
 * Builds a Blossom authorization token and has it signed.
 *
 * The short validity is deliberate: a token without a `server` tag can be
 * spent on any Blossom server at all until it expires, so the window in which
 * an intercepted token is useful has to be kept narrow. Five minutes is amply
 * enough for an upload and not for much else.
 */
export async function creaTokenBlossom(
  firma: FirmaEvento,
  pubkey: string,
  opzioni: OpzioniAutorizzazione,
): Promise<NostrEvent> {
  const adesso = Math.floor(Date.now() / 1000)
  const template = blossomAuthDefinition.build(
    {
      verb: opzioni.verbo,
      expiration: adesso + (opzioni.validitaSecondi ?? 300),
      ...(opzioni.hashes ? { hashes: opzioni.hashes } : {}),
      ...(opzioni.server ? { servers: [hostDi(opzioni.server)] } : {}),
      content: opzioni.descrizione,
    },
    { pubkey, now: adesso },
  )
  return firma(template)
}

/** Turns the HTTP status into a message that tells the user what to do. */
function spiegaStato(stato: number, server: string, ragione: string | undefined): string {
  const coda = ragione ? ` Il server dice: «${ragione}».` : ''
  switch (stato) {
    case 401:
      return `${server} richiede un'autorizzazione firmata e non l'ha accettata.${coda}`
    case 402:
      // BUD-07. Out of the v0 by a project decision: the only thing that
      // counts here is not making a price list look like a fault.
      return `${server} chiede un pagamento per questo caricamento (BUD-07), che questo client non gestisce ancora.${coda}`
    case 403:
      return `${server} non consente questo caricamento.${coda}`
    case 409:
      return `L'hash calcolato dal client non corrisponde a quello ricevuto da ${server}: il file e' cambiato durante l'invio.${coda}`
    case 411:
      return `${server} pretende la dimensione dichiarata in anticipo e la richiesta non l'aveva.${coda}`
    case 413:
      return `Il file supera il limite di dimensione di ${server}.${coda}`
    case 415:
      return `${server} non accetta questo tipo di file.${coda}`
    case 429:
      return `Hai superato il limite di richieste di ${server}. Riprova fra poco.${coda}`
    default:
      return `${server} ha risposto ${stato}.${coda}`
  }
}

async function errore(risposta: Response, server: string): Promise<BlossomError> {
  // `X-Reason` can be read from JavaScript only when the server exposes it
  // with Access-Control-Expose-Headers: when it is missing the message stays
  // generic, and there is no way to do better from the browser.
  const ragione = risposta.headers.get('x-reason') ?? undefined
  return new BlossomError(
    spiegaStato(risposta.status, server, ragione),
    risposta.status,
    server,
    ragione,
  )
}

export interface OpzioniUpload {
  /** Signs the authorization token. Absent: the attempt is made without one. */
  firma?: FirmaEvento
  pubkey?: string
  /** The declared MIME type. The default: the blob's. */
  mime?: string
  /**
   * The original file's name: it is for choosing the extension in the URL.
   *
   * The server decides the extension it answers with, and decides it its own
   * way (`audio/mpeg` → `.mpga` on yakihonne): BUD-01 obliges it to accept any
   * extension at all when reading, so it is rewritten here with the one
   * players expect — `.mp3` — preferring the original name's when that is
   * consistent with the MIME. Verified on two servers.
   */
  nome?: string
  segnale?: AbortSignal
}

/** The descriptor as it arrived, but with the extension the client chose. */
function conEstensioneScelta(
  descrittore: BlobDescriptor,
  mime: string,
  nome?: string,
): BlobDescriptor {
  return { ...descrittore, url: urlConEstensione(descrittore.url, descrittore.type || mime, nome) }
}

/**
 * Uploads a file to a Blossom server (BUD-02, `PUT /upload`).
 *
 * The hash is computed **by the client before sending** and sent in
 * `X-SHA-256`. It is not a formality: the server can refuse in advance without
 * receiving the bytes, and above all a `409` tells us that what arrived is not
 * what we sent — which we would otherwise find out only when the image turns
 * out broken for whoever reads the post.
 */
export async function uploadBlob(
  server: string,
  blob: Blob,
  opzioni: OpzioniUpload = {},
): Promise<BlobDescriptor> {
  const base = server.replace(/\/+$/, '')
  const byte = new Uint8Array(await blob.arrayBuffer())
  const hash = await sha256Hex(byte)

  const intestazioni: Record<string, string> = {
    'Content-Type': opzioni.mime ?? blob.type ?? 'application/octet-stream',
    'X-SHA-256': hash,
  }

  if (opzioni.firma && opzioni.pubkey) {
    const token = await creaTokenBlossom(opzioni.firma, opzioni.pubkey, {
      verbo: 'upload',
      hashes: [hash],
      server: base,
      descrizione: `Carica un file su ${hostDi(base)}`,
    })
    intestazioni.Authorization = encodeAuthHeader(token)
  }

  let risposta: Response
  try {
    risposta = await fetch(`${base}/upload`, {
      method: 'PUT',
      headers: intestazioni,
      body: byte,
      ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
    })
  } catch (e) {
    // From a browser a network failure here is nearly always CORS: the server
    // answered, but without the headers that let the page read it.
    throw new BlossomError(
      `Non e' stato possibile contattare ${base}. Da browser la causa piu' frequente e' la mancanza degli header CORS sulla risposta effettiva, non solo sul preflight. Dettaglio: ${e instanceof Error ? e.message : String(e)}`,
      0,
      base,
    )
  }

  if (!risposta.ok) throw await errore(risposta, base)

  const descrittore = (await risposta.json()) as BlobDescriptor
  if (descrittore.sha256 !== hash) {
    throw new BlossomError(
      `${base} ha restituito un hash diverso da quello inviato: il file e' stato modificato dal server, e il tag "x" dell'evento non corrisponderebbe piu' al contenuto.`,
      risposta.status,
      base,
    )
  }
  return conEstensioneScelta(descrittore, intestazioni['Content-Type'] as string, opzioni.nome)
}

/**
 * Asks a second server to procure the same blob (BUD-04).
 *
 * It does not re-upload the bytes: it passes the URL and the server goes and
 * fetches them. It is the cheap way not to depend on a single host — if that
 * disappears tomorrow, the published event goes on pointing at a dead `url`
 * but with a live `fallback`.
 */
export async function mirrorBlob(
  server: string,
  urlOriginale: string,
  sha256: string,
  opzioni: OpzioniUpload = {},
): Promise<BlobDescriptor> {
  const base = server.replace(/\/+$/, '')
  const intestazioni: Record<string, string> = { 'Content-Type': 'application/json' }

  if (opzioni.firma && opzioni.pubkey) {
    const token = await creaTokenBlossom(opzioni.firma, opzioni.pubkey, {
      verbo: 'upload',
      hashes: [sha256],
      server: base,
      descrizione: `Replica un file su ${hostDi(base)}`,
    })
    intestazioni.Authorization = encodeAuthHeader(token)
  }

  const risposta = await fetch(`${base}/mirror`, {
    method: 'PUT',
    headers: intestazioni,
    body: JSON.stringify({ url: urlOriginale }),
    ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
  })
  if (!risposta.ok) throw await errore(risposta, base)
  const descrittore = (await risposta.json()) as BlobDescriptor
  return conEstensioneScelta(descrittore, opzioni.mime ?? descrittore.type, opzioni.nome)
}

/**
 * Lists the blobs a pubkey has uploaded (BUD-12, `GET /list/<pubkey>`).
 *
 * The authorization is optional **in the specification and in practice**: on
 * blossom.yakihonne.com the list is public, on nostr.download it answers 401.
 * So it is tried without one first: signing a token costs the user a popup
 * from the extension, and asking for it when it is not needed is the way to
 * make a feature look invasive when it is not. Only when the server refuses,
 * and only when we have something to sign with, is it retried with the token
 * (verb `list`).
 */
export async function listBlobs(
  server: string,
  pubkey: string,
  opzioni: { firma?: FirmaEvento; pubkeyFirma?: string } = {},
): Promise<BlobDescriptor[]> {
  const base = server.replace(/\/+$/, '')
  const leggi = async (intestazioni?: Record<string, string>): Promise<Response> =>
    fetch(`${base}/list/${pubkey}`, intestazioni ? { headers: intestazioni } : undefined)

  let risposta = await leggi()

  if (
    (risposta.status === 401 || risposta.status === 403) &&
    opzioni.firma &&
    opzioni.pubkeyFirma
  ) {
    const token = await creaTokenBlossom(opzioni.firma, opzioni.pubkeyFirma, {
      verbo: 'list',
      server: base,
      descrizione: `Elenca i tuoi file su ${hostDi(base)}`,
    })
    risposta = await leggi({ Authorization: encodeAuthHeader(token) })
  }

  if (!risposta.ok) throw await errore(risposta, base)
  const dati = (await risposta.json()) as BlobDescriptor[]
  return Array.isArray(dati) ? dati : []
}

// ── BUD-06: asking before uploading ───────────────────────────────────────

/** A digest that almost certainly matches no blob, for a question about size and type alone. */
const SHA_SEGNAPOSTO = 'f'.repeat(64)

export interface FileDaCaricare {
  peso: number
  mime: string
  /** When known. A size-and-type question works without it. */
  sha256?: string
}

/**
 * The status `HEAD /upload` (BUD-06) answers for a file of this size and type.
 *
 * It is the server telling in advance whether it would accept the upload,
 * without a byte being sent. Shared by the diagnostics page and by the import,
 * which asks before downloading a file from another host.
 */
export async function statoUpload(
  server: string,
  file: FileDaCaricare,
  opzioni: { fetch?: typeof globalThis.fetch; segnale?: AbortSignal } = {},
): Promise<number> {
  const base = server.replace(/\/+$/, '')
  const risposta = await (opzioni.fetch ?? globalThis.fetch)(`${base}/upload`, {
    method: 'HEAD',
    headers: {
      'X-Content-Type': file.mime,
      'X-Content-Length': String(file.peso),
      'X-SHA-256': file.sha256 ?? SHA_SEGNAPOSTO,
    },
    ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
  })
  return risposta.status
}

export type EsitoPreUpload =
  | { esito: 'accettato' }
  /** The server said no in advance: uploading would only waste the download. */
  | { esito: 'rifiutato'; stato: number; motivo: string }
  /**
   * The server would not say. Usually a 401: many servers want the signed
   * token for the question too, and signing one per file would mean a popup
   * from the extension per episode. The upload goes ahead, and the real answer
   * comes from the PUT.
   */
  | { esito: 'sconosciuto'; stato: number | null; motivo: string }

/** Whether the server would accept this file, asked before downloading it. */
export async function accettaUpload(
  server: string,
  file: FileDaCaricare,
  opzioni: { fetch?: typeof globalThis.fetch; segnale?: AbortSignal } = {},
): Promise<EsitoPreUpload> {
  let stato: number
  try {
    stato = await statoUpload(server, file, opzioni)
  } catch {
    return {
      esito: 'sconosciuto',
      stato: null,
      motivo: `${hostDi(server)} non ha risposto alla domanda preventiva: si prova a caricare.`,
    }
  }
  if (stato >= 200 && stato < 300) return { esito: 'accettato' }
  if (stato === 413 || stato === 402 || stato === 415) {
    return { esito: 'rifiutato', stato, motivo: spiegaStato(stato, hostDi(server), undefined) }
  }
  return {
    esito: 'sconosciuto',
    stato,
    motivo: `${hostDi(server)} non dice in anticipo se accetterebbe il file (${stato}): si prova a caricare.`,
  }
}
