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
 * Client del dominio `audio` del media-manager.
 *
 * E' lo **stesso servizio** che compone le immagini e tiene l'archivio: stessa
 * radice, stessa chiave. Sta in un modulo suo perche' e' un dominio distinto
 * del contratto, non perche' sia un'altra installazione.
 *
 * Tutte le lavorazioni sono job: `POST` risponde 202 con `job_id`, e si segue
 * con `GET /audio/job/{id}`. I job sopravvivono al riavvio del servizio,
 * quindi smettere di attendere non perde il lavoro.
 */

export interface OpzioniClientAudio {
  /** Radice del servizio, senza `/v0`. */
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
 * Traduce l'errore diagnostico del servizio in una frase leggibile.
 *
 * Il contratto promette `field`, `value` e `searched_by` proprio perche' un
 * «asset non trovato» da solo non permette di distinguere «ho usato il campo
 * sbagliato» da «il file non c'e'». Buttarli via qui vanificherebbe il lavoro
 * fatto sul servizio per fornirli.
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

  /** Il media con questo titolo, se c'e'. Serve a riusarlo dopo un 409. */
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
      // Nessun content-type a mano: il confine multipart lo scrive fetch.
      const risposta = await chiama('/media', {
        method: 'POST',
        headers: intestazioni(),
        body: modulo,
      })

      /*
       * Un 409 non e' un errore: e' «ce l'ho gia'».
       *
       * Rielaborare la stessa registrazione e' la cosa piu' normale del mondo —
       * si riprova con una soglia diversa, si torna il giorno dopo — e senza
       * questo la seconda volta l'operazione si fermerebbe qui, dicendo che il
       * file esiste come se fosse un guasto. Il record si ritrova per titolo,
       * che e' l'unico appiglio prima di aver visto una risposta.
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
        // Un job che non esiste non e' «in corso»: dirlo com'e' evita
        // un'attesa che non finirebbe mai.
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
      // I byte stanno dietro la chiave: si passa da qui e non da un `fetch`
      // diretto, che riceverebbe 401. Il `signed_url` serve invece ai tag del
      // browser, dove le intestazioni non si possono mettere.
      const percorso = media.download_url.replace(/^\/?v0/, '')
      const risposta = await chiama(percorso.startsWith('/') ? percorso : `/${percorso}`, {
        headers: intestazioni(),
      })
      if (!risposta.ok) await esitoHttp<never>(risposta)
      return risposta.blob()
    },
  }
}
