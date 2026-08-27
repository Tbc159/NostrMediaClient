import { blossomAuthDefinition, type VerboBlossom } from '../kinds/definitions/blossom-auth.js'
import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Client Blossom (BUD-01/02/04/11).
 *
 * Blossom identifica i file per **hash**, non per nome o percorso: lo stesso
 * file caricato su dieci server ha lo stesso identificativo ovunque. Questo
 * cambia il modello mentale rispetto a un normale storage — non si "carica in
 * una cartella", si "rende disponibile un blob" — e rende gratuita la
 * ridondanza: mirrorare significa dire a un secondo server di andarsi a
 * prendere lo stesso hash.
 *
 * L'hash e' anche cio' che lega l'upload all'evento Nostr: il tag `x`
 * dell'imeta e' lo stesso hash, quindi chi legge l'evento puo' verificare che
 * il file scaricato sia esattamente quello che l'autore ha pubblicato.
 */

/** Descrittore restituito dal server dopo un upload riuscito (BUD-02). */
export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type: string
  uploaded: number
}

/** Firma un template. La chiave non passa mai da qui. */
export type FirmaEvento = (template: EventTemplate) => Promise<NostrEvent> | NostrEvent

export class BlossomError extends Error {
  constructor(
    message: string,
    readonly stato: number,
    readonly server: string,
    /** Contenuto dell'header `X-Reason`, se il server lo ha esposto. */
    readonly ragione?: string,
  ) {
    super(message)
    this.name = 'BlossomError'
  }
}

/** Calcola lo SHA-256 esadecimale di un blob. */
export async function sha256Hex(dati: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = dati instanceof Uint8Array ? (dati.slice().buffer as ArrayBuffer) : dati
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Codifica il token per l'header `Authorization`.
 *
 * Base64**url** senza padding, come i JWT: la variante standard usa `+` e `/`,
 * che dentro un header HTTP vanno incontro a proxy e parser troppo zelanti.
 * Il passaggio da TextEncoder e' necessario perche' il `content` del token e'
 * testo leggibile e puo' contenere accenti, che `btoa` da solo non regge.
 */
export function encodeAuthHeader(evento: NostrEvent): string {
  const byte = new TextEncoder().encode(JSON.stringify(evento))
  let binario = ''
  for (const b of byte) binario += String.fromCharCode(b)
  const base64 = btoa(binario)
  return `Nostr ${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** Solo il nome host, che e' cio' che BUD-11 vuole nel tag `server`. */
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
  /** Validita' del token in secondi. Predefinita: 5 minuti. */
  validitaSecondi?: number
  /** Testo mostrato all'utente al momento della firma. */
  descrizione: string
}

/**
 * Costruisce e fa firmare un token di autorizzazione Blossom.
 *
 * La validita' breve e' voluta: un token senza tag `server` e' spendibile su
 * qualunque server Blossom fino alla scadenza, quindi la finestra in cui un
 * token intercettato e' utile va tenuta stretta. Cinque minuti bastano
 * abbondantemente a un upload e non a molto altro.
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

/** Traduce lo stato HTTP in un messaggio che dica all'utente cosa fare. */
function spiegaStato(stato: number, server: string, ragione: string | undefined): string {
  const coda = ragione ? ` Il server dice: «${ragione}».` : ''
  switch (stato) {
    case 401:
      return `${server} richiede un'autorizzazione firmata e non l'ha accettata.${coda}`
    case 402:
      // BUD-07. Fuori dalla v0 per decisione di progetto: qui l'unica cosa che
      // conta e' non far sembrare un guasto quello che e' un listino prezzi.
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
  // `X-Reason` e' leggibile da JavaScript solo se il server lo espone con
  // Access-Control-Expose-Headers: quando manca, il messaggio resta generico
  // e non c'e' modo di fare di meglio dal browser.
  const ragione = risposta.headers.get('x-reason') ?? undefined
  return new BlossomError(
    spiegaStato(risposta.status, server, ragione),
    risposta.status,
    server,
    ragione,
  )
}

export interface OpzioniUpload {
  /** Firma il token di autorizzazione. Assente: si tenta senza autorizzazione. */
  firma?: FirmaEvento
  pubkey?: string
  /** Tipo MIME dichiarato. Predefinito: quello del blob. */
  mime?: string
  segnale?: AbortSignal
}

/**
 * Carica un file su un server Blossom (BUD-02, `PUT /upload`).
 *
 * L'hash viene calcolato **dal client prima dell'invio** e mandato in
 * `X-SHA-256`. Non e' una formalita': il server puo' rifiutare in anticipo
 * senza ricevere i byte, e soprattutto un `409` ci dice che quello che e'
 * arrivato non e' quello che abbiamo mandato — che altrimenti scopriremmo solo
 * quando l'immagine risulta rotta a chi legge il post.
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
    // Da browser un fallimento di rete qui e' quasi sempre CORS: il server ha
    // risposto, ma senza gli header che permettono alla pagina di leggerlo.
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
  return descrittore
}

/**
 * Chiede a un secondo server di procurarsi lo stesso blob (BUD-04).
 *
 * Non ricarica i byte: passa l'URL e il server se li va a prendere. E' il modo
 * economico per non dipendere da un solo host — se domani sparisce, l'evento
 * pubblicato continua a puntare a un `url` morto ma con un `fallback` vivo.
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
  return (await risposta.json()) as BlobDescriptor
}

/** Elenca i blob caricati da una pubkey (BUD-12, `GET /list/<pubkey>`). */
export async function listBlobs(server: string, pubkey: string): Promise<BlobDescriptor[]> {
  const base = server.replace(/\/+$/, '')
  const risposta = await fetch(`${base}/list/${pubkey}`)
  if (!risposta.ok) throw await errore(risposta, base)
  const dati = (await risposta.json()) as BlobDescriptor[]
  return Array.isArray(dati) ? dati : []
}
