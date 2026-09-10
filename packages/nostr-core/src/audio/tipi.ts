import type { MediaItem } from '../mediamanager/types.js'

/**
 * Elaborazione audio: cosa il client puo' chiedere, senza dire a chi.
 *
 * Il dominio `audio` del media-manager ha sostituito il servizio precedente, e
 * con esso i suoi vincoli: **l'ordine delle operazioni e' libero, i formati
 * sono indifferenti, e nessuna operazione distrugge la sorgente**. Quindi qui
 * non c'e' piu' alcuna strategia da calcolare prima di chiedere: si manda un
 * riferimento e si aspetta un lavoro.
 *
 * L'interfaccia resta separata dall'implementazione perche' e' cio' che rende
 * l'attesa dei lavori provabile senza rete, non perche' si preveda un altro
 * servizio.
 */

/** Formati che il dominio audio accetta in ingresso e sa produrre. */
export type FormatoAudio = 'audio/mpeg' | 'audio/m4a' | 'audio/wav'

/**
 * Riferimento a un media in archivio: l'id numerico oppure il **filename**.
 *
 * Il `filename` lo genera il servizio e va riletto dalla risposta: il `title`
 * che hai inviato non e' un riferimento valido.
 */
export type RiferimentoAudio = number | string

/** Un file prodotto da una lavorazione. */
export interface MediaProdotto {
  id: number
  media_type: string
  content_url: string
  download_url: string
  /**
   * URL dei byte utilizzabile **senza intestazioni**, a scadenza.
   *
   * E' l'unico che si puo' mettere in un `<audio src>`: il browser non allega
   * la chiave alle richieste di sotto-risorsa, e `content_url` li' riceve 401.
   * Manca se l'ambiente del servizio non ha una chiave di firma.
   */
  signed_url?: string
  signed_url_expires_at_s?: number
}

export interface OpzioniSilenzi {
  /**
   * Sotto questo livello e' silenzio, in decibel (per esempio -40).
   *
   * Numero e non stringa: l'unita' la mette il servizio. Prima andava scritta
   * a mano (`-40dB`) e ometterla significava passare un'ampiezza lineare, cioe'
   * non tagliare nulla senza che nulla lo dicesse.
   */
  sogliaDb: number
  /** Quanto deve durare una pausa perche' venga accorciata, in secondi. */
  pausaMinimaS: number
  /** Quanto silenzio lasciare: le pause si accorciano, non si azzerano. */
  silenzioDaLasciareS?: number
  /** Formato del prodotto. Il servizio usa il wav quando non si dice nulla. */
  formato?: FormatoAudio
  titolo?: string
}

export interface OpzioniLivellamento {
  formato?: FormatoAudio
  titolo?: string
}

export interface StatoLavoro {
  stato: 'in-coda' | 'in-corso' | 'completato' | 'fallito'
  /** Presente a lavoro completato: i file prodotti, in ordine. */
  media?: MediaProdotto[]
  errore?: string
}

export interface ServizioAudio {
  readonly radice: string
  /** Se il dominio audio risponde. */
  disponibile(): Promise<boolean>
  /** Manda i byte in archivio. Il riferimento da usare poi e' il `filename`. */
  carica(file: Blob, titolo: string, mime: FormatoAudio): Promise<MediaItem>
  /** Accorcia i silenzi. Restituisce l'identificativo del lavoro. */
  avviaSilenzi(sorgente: RiferimentoAudio, opzioni: OpzioniSilenzi): Promise<string>
  /** Livella le voci. Restituisce l'identificativo del lavoro. */
  avviaLivellamento(sorgente: RiferimentoAudio, opzioni?: OpzioniLivellamento): Promise<string>
  /** Cambia formato. Restituisce l'identificativo del lavoro. */
  avviaConversione(
    sorgente: RiferimentoAudio,
    formato: FormatoAudio,
    titolo?: string,
  ): Promise<string>
  stato(idLavoro: string): Promise<StatoLavoro>
  /** I byte di un prodotto, per riascoltarlo o salvarlo. */
  scarica(media: MediaProdotto): Promise<Blob>
}

/** Estensione consueta di un formato, per comporre un nome di file. */
export function estensioneDi(formato: FormatoAudio): string {
  if (formato === 'audio/mpeg') return 'mp3'
  if (formato === 'audio/m4a') return 'm4a'
  return 'wav'
}

/**
 * Il formato di un file dal suo nome, o `null` se non e' un audio trattabile.
 *
 * `mp3` diventa `audio/mpeg`, che e' il tipo registrato: il servizio accetta
 * `audio/mp3` come alias, ma non c'e' ragione di propagare un nome sbagliato.
 */
export function formatoDaNome(nome: string): FormatoAudio | null {
  const ext = nome.toLowerCase().split('.').pop() ?? ''
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'm4a') return 'audio/m4a'
  if (ext === 'wav') return 'audio/wav'
  return null
}
