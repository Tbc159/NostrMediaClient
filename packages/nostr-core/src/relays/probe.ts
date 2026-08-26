/**
 * Sonde diagnostiche per relay e server Blossom.
 *
 * Modulo isomorfico: `WebSocket` e `fetch` sono globali sia in Node 22 sia nel
 * browser, quindi lo stesso codice serve lo script da riga di comando
 * (`pnpm check:endpoints`) e la pagina di diagnostica dell'app.
 *
 * Qui non si stampa nulla: le funzioni restituiscono dati strutturati e la
 * presentazione resta a chi chiama.
 *
 * Nessuna chiave privata e' coinvolta: tutte le verifiche sono anonime.
 */

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Vero quando il codice gira su Node e non in un browser.
 *
 * Si rileva Node invece del browser di proposito: questo modulo deve restare
 * isomorfico, e `window`/`document` sono vietati qui (lo impone anche
 * `no-restricted-globals` in eslint.config.js). Serve solo a qualificare i
 * messaggi d'errore, non a cambiare comportamento.
 */
const inNode = typeof process !== 'undefined' && process.versions?.node !== undefined

/** Sottoinsieme del documento NIP-11 che ci interessa. */
export interface RelayInfo {
  name?: string
  description?: string
  software?: string
  version?: string
  supported_nips?: number[]
  payments_url?: string
  fees?: unknown
  limitation?: {
    payment_required?: boolean
    auth_required?: boolean
    restricted_writes?: boolean
    max_message_length?: number
  }
}

export interface RelayProbeResult {
  url: string
  /** Vero se il relay ha risposto con dati (EVENT o EOSE). */
  reachable: boolean
  /** Millisecondi fino all'apertura della connessione. */
  connectMs?: number
  /** Millisecondi fino al primo dato utile. */
  firstDataMs?: number
  /** Il relay ha inviato AUTH: richiede identita' anche solo per leggere. */
  authRequested: boolean
  /** Motivo machine-readable di un CLOSED, se ricevuto. */
  closedReason?: string
  notices: string[]
  error?: string
  /**
   * Il primo tentativo era fallito ed e' stato necessario ritentare.
   * Segnala un relay instabile o con rate limit per IP.
   */
  retried: boolean
}

export interface RelayCheck {
  url: string
  probe: RelayProbeResult
  info?: RelayInfo
  /** Perche' NIP-11 non e' stato leggibile. Non e' bloccante. */
  infoError?: string
}

export interface ProbeOptions {
  timeoutMs?: number
  /** Ritenta una volta se il primo tentativo fallisce. Default: true. */
  retry?: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Converte wss:// in https:// per interrogare il documento NIP-11. */
export function relayHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}

/**
 * Legge il documento NIP-11 di un relay.
 *
 * Dal browser puo' fallire per CORS anche quando il relay e' perfettamente
 * raggiungibile via WebSocket: non e' un errore bloccante e va trattato come
 * informazione mancante, non come relay guasto.
 */
export async function fetchRelayInfo(
  wsUrl: string,
  options: ProbeOptions = {},
): Promise<RelayInfo> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const res = await withTimeout(
    fetch(relayHttpUrl(wsUrl), { headers: { Accept: 'application/nostr+json' } }),
    timeoutMs,
    'timeout',
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as RelayInfo
}

/** Un singolo tentativo di connessione: apre, chiede un evento, misura. */
function probeOnce(url: string, timeoutMs: number): Promise<RelayProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    const result: RelayProbeResult = {
      url,
      reachable: false,
      authRequested: false,
      notices: [],
      retried: false,
    }

    let ws: WebSocket | undefined
    let settled = false

    const finish = (extra: Partial<RelayProbeResult> = {}): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        // La connessione puo' essere gia' chiusa: non e' un problema.
      }
      resolve({ ...result, ...extra })
    }

    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs)

    try {
      ws = new WebSocket(url)
    } catch (err) {
      return finish({ error: err instanceof Error ? err.message : String(err) })
    }

    ws.onopen = (): void => {
      result.connectMs = Date.now() - started
      ws?.send(JSON.stringify(['REQ', 'nmc-probe', { kinds: [1], limit: 1 }]))
    }

    ws.onmessage = (ev: MessageEvent): void => {
      let msg: unknown
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!Array.isArray(msg)) return

      switch (msg[0]) {
        case 'EVENT':
        case 'EOSE':
          finish({ reachable: true, firstDataMs: Date.now() - started })
          break
        case 'AUTH':
          result.authRequested = true
          break
        case 'NOTICE':
          result.notices.push(String(msg[1]).slice(0, 160))
          break
        case 'CLOSED':
          finish({ closedReason: String(msg[2] ?? '').slice(0, 200) })
          break
      }
    }

    ws.onerror = (): void => finish({ error: 'connessione fallita' })
    ws.onclose = (): void => finish({ error: 'chiusa prima di ricevere dati' })
  })
}

/**
 * Sonda un relay, ritentando una volta di default.
 *
 * I relay pubblici rifiutano connessioni in modo intermittente quando sono
 * sotto carico o applicano un rate limit per IP. Dichiararli irraggiungibili
 * al primo tentativo produce diagnosi sbagliate.
 */
export async function probeRelay(
  url: string,
  options: ProbeOptions = {},
): Promise<RelayProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retry = options.retry ?? true

  const primo = await probeOnce(url, timeoutMs)
  if (primo.reachable || !retry) return primo

  await sleep(1500)
  const secondo = await probeOnce(url, timeoutMs)
  return { ...secondo, retried: true }
}

/** Sonda un relay e ne legge il documento NIP-11 in parallelo. */
export async function checkRelay(url: string, options: ProbeOptions = {}): Promise<RelayCheck> {
  const [probe, info] = await Promise.all([
    probeRelay(url, options),
    fetchRelayInfo(url, options).catch((err: unknown) => ({
      __error: err instanceof Error ? err.message : String(err),
    })),
  ])

  if ('__error' in info) {
    return { url, probe, infoError: info.__error }
  }
  return { url, probe, info }
}

// --- Blossom ----------------------------------------------------------------

export interface BlossomCheck {
  url: string
  /** Il server risponde. */
  reachable: boolean
  /** Ha risposto 404 a un blob inesistente: si comporta da server Blossom. */
  speaksBlossom: boolean
  /** Stato di HEAD /upload (BUD-06). */
  uploadStatus?: number
  /** Interpretazione dello stato di upload. */
  uploadHint?: string
  error?: string
}

/** Un digest che quasi certamente non corrisponde ad alcun blob. */
const SHA_INESISTENTE = 'f'.repeat(64)

/**
 * Verifica un server Blossom senza caricare nulla e senza firmare.
 *
 * La prova di identita' e' BUD-01: `GET /<sha256>` di un blob assente deve
 * rispondere 404. Un server generico risponderebbe altro.
 */
export async function checkBlossomServer(
  url: string,
  options: ProbeOptions = {},
): Promise<BlossomCheck> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = url.replace(/\/+$/, '')
  const result: BlossomCheck = { url: base, reachable: false, speaksBlossom: false }

  try {
    // `redirect: 'follow'` e non 'manual': molti server Blossom rispondono 302
    // verso una CDN, e nel browser una risposta di tipo opaqueredirect non e'
    // leggibile. Seguire il redirect e' l'unico comportamento che funziona in
    // entrambi gli ambienti.
    const res = await withTimeout(
      fetch(`${base}/${SHA_INESISTENTE}`, { method: 'GET', redirect: 'follow' }),
      timeoutMs,
      'timeout',
    )
    result.reachable = true
    result.speaksBlossom = res.status === 404
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const scaduto = msg.toLowerCase().includes('timeout')

    // La causa va qualificata, non indovinata. Un timeout e' lentezza o
    // irraggiungibilita'; un errore di rete dal browser, a fronte di un server
    // che da Node risponde, e' quasi sempre CORS — tipicamente perche' il
    // server manda Access-Control-Allow-Origin solo sul preflight OPTIONS e
    // non sulla risposta effettiva. Attribuire un timeout a CORS manda fuori
    // strada chi legge.
    if (scaduto) {
      result.error = `${msg} (oltre ${timeoutMs} ms): server lento o irraggiungibile`
    } else if (inNode) {
      result.error = msg
    } else {
      result.error =
        `${msg} — dal browser questo e' quasi sempre CORS: il server non espone ` +
        `Access-Control-Allow-Origin sulla risposta effettiva (alcuni lo mandano solo ` +
        `sul preflight OPTIONS, e non basta). Confrontare con \`pnpm check:endpoints\`, ` +
        `che gira su Node e non subisce CORS.`
    }
    return result
  }

  // BUD-06: HEAD /upload anticipa se l'upload verrebbe accettato. Senza evento
  // di autorizzazione kind 24242 ci aspettiamo 401, che e' l'esito sano.
  try {
    const res = await withTimeout(
      fetch(`${base}/upload`, {
        method: 'HEAD',
        headers: {
          'X-Content-Type': 'image/png',
          'X-Content-Length': '1024',
          'X-SHA-256': SHA_INESISTENTE,
        },
      }),
      timeoutMs,
      'timeout',
    )
    result.uploadStatus = res.status
    result.uploadHint =
      res.status === 401
        ? 'protetto da autorizzazione kind 24242, come previsto'
        : res.status === 402
          ? 'upload a pagamento (BUD-07): fuori dallo scope della v0'
          : res.status === 200
            ? 'accettato senza autorizzazione: server aperto in scrittura'
            : `risposta inattesa a HEAD /upload: BUD-06 potrebbe non essere implementato`
  } catch {
    result.uploadHint = 'HEAD /upload non verificabile (possibile blocco CORS dal browser)'
  }

  return result
}
