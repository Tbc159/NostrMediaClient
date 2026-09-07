import {
  chiama,
  esito,
  ErroreServizio,
  normalizzaBaseUrl,
  type OpzioniChiamata,
} from '../servizi/http.js'
import type { CodecAudio, OpzioniSilenzi, ServizioAudio, StatoLavoro } from './tipi.js'

/**
 * Adattatore per il servizio `ffmpeg` di `microservices-media`.
 *
 * E' l'unico deployato che sappia elaborare audio, e ha alcune abitudini che
 * vanno assorbite qui invece di trapelare nelle pagine.
 *
 * **Le cartelle.** Il servizio tiene tutto sotto `uploads/`: un caricamento
 * `mp3` finisce in `uploads/mp3_media`, il taglio dei silenzi legge **proprio
 * da li'** e scrive in `uploads/clean`, la normalizzazione scrive in
 * `uploads/normalized`. Ne discendono due conseguenze non ovvie:
 *
 *  1. **L'ordine e' obbligato**: silenzi prima, livellamento poi. Al contrario
 *     il file normalizzato finisce in `normalized/` e il taglio dei silenzi,
 *     che guarda in `mp3_media/`, non lo trova — e' quasi certamente il motivo
 *     per cui nello script `create_yt_media.py` quel passaggio e' commentato.
 *     La stessa inversione e' anche quella giusta per la qualita': normalizzare
 *     prima alza il rumore di fondo sopra la soglia di silenzio.
 *  2. **Il taglio dei silenzi vale solo per gli mp3.** Un m4a va convertito
 *     prima; per un wav non esiste convertitore.
 *
 * **Il passaggio fra un'operazione e l'altra** avviene per URL: `/voice/download`
 * cerca ricorsivamente in tutto `uploads/`, quindi un file trova sempre la
 * strada indipendentemente dalla cartella in cui e' finito. E' lo stesso
 * espediente usato dal loro script.
 */

export interface OpzioniServizioLegacy extends OpzioniChiamata {
  /** Radice del servizio, per esempio `http://api-v0-bitcoinradio.duckdns.org`. */
  baseUrl: string
}

interface RispostaLavoro {
  job_id: string
}

interface RispostaStato {
  status: 'pending' | 'done' | 'error'
  result?: { output_file?: string; download_link?: string; error?: string; input_file?: string }
}

export function creaServizioAudioLegacy(opzioni: OpzioniServizioLegacy): ServizioAudio {
  const radice = normalizzaBaseUrl(opzioni.baseUrl)
  if (radice === '') throw new Error('Indirizzo del servizio audio mancante.')

  const rete: OpzioniChiamata = {
    ...(opzioni.fetch ? { fetch: opzioni.fetch } : {}),
    ...(opzioni.timeoutMs !== undefined ? { timeoutMs: opzioni.timeoutMs } : {}),
  }

  const json = (percorso: string, corpo: unknown): Promise<Response> =>
    chiama(
      `${radice}${percorso}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      },
      rete,
    )

  return {
    radice,

    async disponibile() {
      try {
        // Il servizio non espone un health check. Si interroga un lavoro che
        // non esiste: un 404 con corpo JSON prova che c'e' e che risponde,
        // senza modificare nulla.
        const r = await chiama(`${radice}/media/job/sonda`, { method: 'GET' }, rete)
        return r.status === 404 || r.ok
      } catch {
        return false
      }
    },

    async carica(file, nome, codec) {
      // Il servizio verifica che l'estensione corrisponda al codec dichiarato:
      // meglio correggerla qui che farsi rifiutare con un 400.
      const atteso = `.${codec}`
      const nomeFinale = nome.toLowerCase().endsWith(atteso)
        ? nome
        : `${nome.replace(/\.[^.]+$/, '')}${atteso}`

      const modulo = new FormData()
      modulo.append('file', file, nomeFinale)
      modulo.append('nome_file', nomeFinale)
      modulo.append('codec_audio', codec)

      const risposta = await chiama(
        `${radice}/media/upload`,
        { method: 'POST', body: modulo },
        rete,
      )
      await esito<{ message: string }>(risposta)
      return nomeFinale
    },

    async convertiInMp3(nome) {
      const risposta = await json('/media/m4a_to_mp3', { input_file: nome })
      return (await esito<RispostaLavoro>(risposta)).job_id
    },

    async togliSilenzi(nome, opzioni: OpzioniSilenzi) {
      const risposta = await json('/media/remove_silence', {
        input_file: nome,
        seconds_silence: opzioni.durataMinimaS,
        silence_level: opzioni.soglia,
      })

      if (risposta.status === 404) {
        // Caso frequente e con una causa precisa: il file non e' nella cartella
        // che questa operazione guarda. Dirlo e' piu' utile di «non trovato».
        throw new ErroreServizio(
          `Il servizio non trova «${nome}» fra i file su cui sa togliere i silenzi. ` +
            'Questa operazione legge solo dalla cartella degli mp3: un m4a va convertito prima, ' +
            'e un file gia’ livellato non e’ piu’ raggiungibile da qui.',
          404,
        )
      }

      await esito<{ message: string }>(risposta)
      // L'operazione e' sincrona e conserva il nome: scrive in un'altra
      // cartella, ma `/voice/download` la trova comunque.
      return nome
    },

    async livella(nome, codec) {
      const risposta = await json('/media/normalize', {
        // Si passa un URL e non un nome: il servizio lo scarica da se', e
        // `/voice/download` cerca in tutte le cartelle. Passando il solo nome
        // cercherebbe in una cartella sola e spesso non lo troverebbe.
        source_file: `${radice}/voice/download/${encodeURIComponent(nome)}`,
        codec_audio: codec,
      })
      return (await esito<RispostaLavoro>(risposta)).job_id
    },

    async stato(idLavoro): Promise<StatoLavoro> {
      const risposta = await chiama(
        `${radice}/media/job/${encodeURIComponent(idLavoro)}`,
        { method: 'GET' },
        rete,
      )
      const corpo = await esito<RispostaStato>(risposta)

      if (corpo.status === 'done') {
        const prodotto = corpo.result?.output_file ?? corpo.result?.input_file
        return prodotto ? { stato: 'completato', risultato: prodotto } : { stato: 'completato' }
      }
      if (corpo.status === 'error') {
        return {
          stato: 'fallito',
          errore: corpo.result?.error ?? 'Il servizio non ha detto perche’.',
        }
      }
      return { stato: 'in-corso' }
    },

    async scarica(nome) {
      const risposta = await chiama(
        `${radice}/voice/download/${encodeURIComponent(nome)}`,
        { method: 'GET' },
        rete,
      )
      if (!risposta.ok) {
        throw new ErroreServizio(
          `Il servizio non ha restituito «${nome}» (${risposta.status}).`,
          risposta.status,
        )
      }
      return risposta.blob()
    },
  }
}

/** Il nome che il servizio dara' al file livellato. Serve a riconoscerlo. */
export function nomeLivellato(nome: string, codec: CodecAudio): string {
  const base = nome.replace(/\/+$/, '').split('/').pop() ?? nome
  return `${base.replace(/\.[^.]+$/, '')}_normalized.${codec}`
}
