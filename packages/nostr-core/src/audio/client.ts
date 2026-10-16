import {
  chiama as chiamaHttp,
  esito as esitoHttp,
  ErroreServizio,
  normalizzaBaseUrl,
} from '../servizi/http.js'
import type { MediaItem } from '../mediamanager/types.js'
import type {
  FormatoAudio,
  MediaProdotto,
  OpzioniLivellamento,
  OpzioniSilenzi,
  RiferimentoAudio,
  ServizioAudio,
  StatoLavoro,
} from './tipi.js'

/**
 * The client for the media-manager's `audio` domain.
 *
 * It is the **same service** that composes images and keeps the archive: same
 * root, same key. It lives in a module of its own because it is a separate
 * domain of the contract, not because it is another installation.
 *
 * Every processing job is a job: `POST` answers 202 with a `job_id`, and you
 * follow it with `GET /audio/job/{id}`. Jobs survive a restart of the
 * service, so giving up waiting does not lose the work.
 *
 * The messages stay in Italian: the Audio page shows them.
 */

export interface OpzioniClientAudio {
  /** The service's root, without `/v0`. */
  baseUrl: string
  apiKey?: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

const VERSIONE_API = 'v0'

interface RispostaJob {
  job_id: string
  status: string
  poll_url?: string
}

interface RispostaStato {
  job_id: string
  op: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  result?: { media?: MediaProdotto[] } | null
  error?: { detail?: string; field?: string; value?: unknown; searched_by?: string } | null
}

/**
 * Turns the service's diagnostic error into a readable sentence.
 *
 * The contract promises `field`, `value` and `searched_by` precisely because
 * an «asset not found» on its own does not let you tell «I used the wrong
 * field» from «the file is not there». Throwing them away here would undo the
 * work done on the service to provide them.
 */
function spiegaErroreLavoro(e: RispostaStato['error']): string {
  if (!e) return 'motivo non riportato'
  const dettaglio = e.detail ?? 'motivo non riportato'
  if (!e.field) return dettaglio
  const cercato = e.searched_by ? `, cercato per ${e.searched_by}` : ''
  return `${dettaglio} (campo ${e.field}: ${JSON.stringify(e.value)}${cercato})`
}

export function creaServizioAudio(opzioni: OpzioniClientAudio): ServizioAudio {
  const radice = normalizzaBaseUrl(opzioni.baseUrl)
  if (radice === '') throw new Error('Indirizzo del servizio audio mancante.')

  const rete = {
    ...(opzioni.fetch ? { fetch: opzioni.fetch } : {}),
    ...(opzioni.timeoutMs !== undefined ? { timeoutMs: opzioni.timeoutMs } : {}),
  }

  const intestazioni = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(opzioni.apiKey ? { 'X-API-Key': opzioni.apiKey } : {}),
    ...extra,
  })

  const chiama = (percorso: string, init: RequestInit = {}): Promise<Response> =>
    chiamaHttp(`${radice}/${VERSIONE_API}${percorso}`, init, rete)

  const postJson = async (percorso: string, corpo: unknown): Promise<string> => {
    const risposta = await chiama(percorso, {
      method: 'POST',
      headers: intestazioni({ 'content-type': 'application/json' }),
      body: JSON.stringify(corpo),
    })
    const lavoro = await esitoHttp<RispostaJob>(risposta)
    if (!lavoro.job_id) {
      throw new ErroreServizio(
        'Il servizio ha accettato il lavoro ma non ne dice l’identificativo.',
        null,
      )
    }
    return lavoro.job_id
  }

  /** The medium with this title, when there is one. It is what reuses it after a 409. */
  async function cercaPerTitolo(titolo: string, mime: string): Promise<MediaItem | null> {
    const q = new URLSearchParams({ type: mime, title: titolo })
    const risposta = await chiama(`/media?${q}`, { headers: intestazioni() })
    if (!risposta.ok) return null
    const elenco = await esitoHttp<{ items?: MediaItem[] }>(risposta)
    return elenco.items?.find((m) => m.title === titolo) ?? elenco.items?.[0] ?? null
  }

  return {
    radice,

    async disponibile() {
      try {
        return (await chiama('/audio/health')).ok
      } catch {
        return false
      }
    },

    async carica(file, titolo, mime) {
      const modulo = new FormData()
      modulo.append('file', file, titolo)
      modulo.append('title', titolo)
      modulo.append('media_type', mime)
      // No content-type by hand: fetch writes the multipart boundary.
      const risposta = await chiama('/media', {
        method: 'POST',
        headers: intestazioni(),
        body: modulo,
      })

      /*
       * A 409 is not an error: it is «I have it already».
       *
       * Reprocessing the same recording is the most normal thing in the world
       * — you try again with a different threshold, you come back the next
       * day — and without this the second attempt would stop here, saying the
       * file exists as though that were a fault. The record is found again by
       * title, which is the only handle available before seeing a response.
       */
      if (risposta.status === 409) {
        const esistente = await cercaPerTitolo(titolo, mime)
        if (esistente) return esistente
      }
      return esitoHttp<MediaItem>(risposta)
    },

    avviaSilenzi(sorgente: RiferimentoAudio, o: OpzioniSilenzi) {
      return postJson('/audio/silence', {
        source: sorgente,
        threshold_db: o.sogliaDb,
        min_pause_s: o.pausaMinimaS,
        ...(o.silenzioDaLasciareS !== undefined ? { keep_silence_s: o.silenzioDaLasciareS } : {}),
        ...(o.formato ? { format: o.formato } : {}),
        ...(o.titolo ? { title: o.titolo } : {}),
      })
    },

    avviaLivellamento(sorgente: RiferimentoAudio, o: OpzioniLivellamento = {}) {
      return postJson('/audio/normalize', {
        source: sorgente,
        ...(o.formato ? { format: o.formato } : {}),
        ...(o.titolo ? { title: o.titolo } : {}),
      })
    },

    avviaConversione(sorgente: RiferimentoAudio, formato: FormatoAudio, titolo?: string) {
      return postJson('/audio/convert', {
        source: sorgente,
        format: formato,
        ...(titolo ? { title: titolo } : {}),
      })
    },

    async stato(idLavoro) {
      const risposta = await chiama(`/audio/job/${encodeURIComponent(idLavoro)}`, {
        headers: intestazioni(),
      })
      if (risposta.status === 404) {
        // A job that does not exist is not «in progress»: saying so as it is
        // avoids a wait that would never end.
        throw new ErroreServizio(`Il servizio non conosce il lavoro ${idLavoro}.`, 404)
      }
      const j = await esitoHttp<RispostaStato>(risposta)

      if (j.status === 'succeeded') {
        return { stato: 'completato', media: j.result?.media ?? [] } satisfies StatoLavoro
      }
      if (j.status === 'failed') {
        return { stato: 'fallito', errore: spiegaErroreLavoro(j.error) } satisfies StatoLavoro
      }
      return { stato: j.status === 'queued' ? 'in-coda' : 'in-corso' } satisfies StatoLavoro
    },

    async scarica(media) {
      // The bytes sit behind the key: this is the way through, not a direct
      // `fetch`, which would get a 401. The `signed_url` is for the browser's
      // own tags instead, where headers cannot be set.
      const percorso = media.download_url.replace(/^\/?v0/, '')
      const risposta = await chiama(percorso.startsWith('/') ? percorso : `/${percorso}`, {
        headers: intestazioni(),
      })
      if (!risposta.ok) await esitoHttp<never>(risposta)
      return risposta.blob()
    },
  }
}
