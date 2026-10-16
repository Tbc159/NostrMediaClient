/**
 * Diagnostic probes for relays and Blossom servers.
 *
 * An isomorphic module: `WebSocket` and `fetch` are globals both in Node 22
 * and in the browser, so the same code serves the command-line script
 * (`pnpm check:endpoints`) and the app's diagnostics page.
 *
 * Nothing is printed here: the functions return structured data and the
 * presentation stays with the caller.
 *
 * No private key is involved: every check is anonymous.
 */

const DEFAULT_TIMEOUT_MS = 8000

/**
 * True when the code runs on Node and not in a browser.
 *
 * Node is detected rather than the browser on purpose: this module has to stay
 * isomorphic, and `window`/`document` are forbidden here (`no-restricted-globals`
 * in eslint.config.js enforces it too). It serves only to qualify the error
 * messages, not to change behaviour.
 */
const inNode = typeof process !== 'undefined' && process.versions?.node !== undefined

/** The subset of the NIP-11 document we care about. */
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
  /** True when the relay answered with data (EVENT or EOSE). */
  reachable: boolean
  /** Milliseconds until the connection opened. */
  connectMs?: number
  /** Milliseconds until the first useful piece of data. */
  firstDataMs?: number
  /** The relay sent AUTH: it asks for an identity even just to read. */
  authRequested: boolean
  /** The machine-readable reason of a CLOSED, when one was received. */
  closedReason?: string
  notices: string[]
  error?: string
  /**
   * The first attempt had failed and a retry was necessary.
   * It points to an unstable relay, or one with a per-IP rate limit.
   */
  retried: boolean
}

export interface RelayCheck {
  url: string
  probe: RelayProbeResult
  info?: RelayInfo
  /** Why NIP-11 could not be read. It is not blocking. */
  infoError?: string
}

export interface ProbeOptions {
  timeoutMs?: number
  /** Retry once when the first attempt fails. Default: true. */
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

/** Turns wss:// into https:// to query the NIP-11 document. */
export function relayHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}

/**
 * Reads a relay's NIP-11 document.
 *
 * From the browser it can fail on CORS even when the relay is perfectly
 * reachable over WebSocket: it is not a blocking error and it should be
 * treated as missing information, not as a broken relay.
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

/** A single connection attempt: it opens, asks for an event, measures. */
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
        // The connection may be closed already: that is no problem.
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
 * Probes a relay, retrying once by default.
 *
 * Public relays refuse connections intermittently when they are under load or
 * apply a per-IP rate limit. Declaring them unreachable on the first attempt
 * produces wrong diagnoses.
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

/** Probes a relay and reads its NIP-11 document in parallel. */
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
  /** The server answers. */
  reachable: boolean
  /** It answered 404 to a non-existent blob: it behaves like a Blossom server. */
  speaksBlossom: boolean
  /** The status of HEAD /upload (BUD-06). */
  uploadStatus?: number
  /** The reading of the upload status. */
  uploadHint?: string
  error?: string
}

/** A digest that almost certainly matches no blob. */
const SHA_INESISTENTE = 'f'.repeat(64)

/**
 * Checks a Blossom server without uploading anything and without signing.
 *
 * The proof of identity is BUD-01: `GET /<sha256>` of an absent blob must
 * answer 404. A generic server would answer something else.
 */
export async function checkBlossomServer(
  url: string,
  options: ProbeOptions = {},
): Promise<BlossomCheck> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = url.replace(/\/+$/, '')
  const result: BlossomCheck = { url: base, reachable: false, speaksBlossom: false }

  try {
    // `redirect: 'follow'` and not 'manual': many Blossom servers answer 302
    // towards a CDN, and in the browser a response of type opaqueredirect
    // cannot be read. Following the redirect is the only behaviour that works
    // in both environments.
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

    // The cause has to be qualified, not guessed. A timeout is slowness or
    // unreachability; a network error from the browser, against a server that
    // answers from Node, is nearly always CORS — typically because the server
    // sends Access-Control-Allow-Origin only on the OPTIONS preflight and not
    // on the actual response. Blaming CORS for a timeout sends the reader off
    // in the wrong direction.
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

  // BUD-06: HEAD /upload says in advance whether the upload would be accepted.
  // Without a kind 24242 authorization event we expect a 401, which is the
  // healthy outcome.
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
