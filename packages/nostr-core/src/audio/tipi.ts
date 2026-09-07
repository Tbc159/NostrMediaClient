/**
 * Pre-elaborazione audio: cosa il client puo' chiedere, senza dire a chi.
 *
 * L'interfaccia sta a monte dell'implementazione perche' oggi il servizio che
 * sa fare queste cose e' quello vecchio (`microservices-media`, servizio
 * `ffmpeg`) e domani sara' un dominio del microservizio nuovo. Le rotte
 * cambieranno; le pagine che le usano no.
 *
 * Le operazioni si scambiano **nomi di file**, non byte: e' cosi' che ragiona
 * il servizio, che tiene un proprio archivio e vi si riferisce per nome.
 */

export type CodecAudio = 'mp3' | 'm4a' | 'wav'

export interface OpzioniSilenzi {
  /**
   * Sotto questo livello e' silenzio. Vuole l'unita': `-40dB`.
   *
   * Senza unita' il valore e' interpretato come ampiezza lineare, e un `-40`
   * scritto per sbaglio non taglierebbe nulla senza dirlo.
   */
  soglia: string
  /** Quanto deve durare un silenzio per essere tagliato, in secondi. */
  durataMinimaS: number
}

export interface StatoLavoro {
  stato: 'in-corso' | 'completato' | 'fallito'
  /** Nome del file prodotto, presente solo a lavoro completato. */
  risultato?: string
  errore?: string
}

/**
 * Se il taglio dei silenzi e' possibile per un certo formato.
 *
 * Non e' una scelta nostra ma una conseguenza di come il servizio dispone le
 * cartelle: `remove_silence` legge da quella degli mp3. Un m4a va convertito
 * prima; per un wav non esiste un convertitore, quindi l'operazione non e'
 * disponibile — e l'interfaccia lo dice invece di far fallire la richiesta.
 */
export type StrategiaSilenzi = 'diretta' | 'conversione' | 'non-disponibile'

export function strategiaSilenzi(codec: CodecAudio): StrategiaSilenzi {
  if (codec === 'mp3') return 'diretta'
  if (codec === 'm4a') return 'conversione'
  return 'non-disponibile'
}

export interface ServizioAudio {
  readonly radice: string
  /** Se il servizio risponde. Non richiede autenticazione. */
  disponibile(): Promise<boolean>
  /** Manda i byte al servizio. Restituisce il nome con cui vi e' conosciuto. */
  carica(file: Blob, nome: string, codec: CodecAudio): Promise<string>
  /** m4a → mp3. Asincrono: restituisce l'identificativo del lavoro. */
  convertiInMp3(nome: string): Promise<string>
  /** Taglia i silenzi. Sincrono: restituisce il nome del risultato. */
  togliSilenzi(nome: string, opzioni: OpzioniSilenzi): Promise<string>
  /** Livella le voci. Asincrono: restituisce l'identificativo del lavoro. */
  livella(nome: string, codec: CodecAudio): Promise<string>
  stato(idLavoro: string): Promise<StatoLavoro>
  scarica(nome: string): Promise<Blob>
}

/** Estensione attesa per un codec, come la pretende il servizio. */
export function estensioneDi(codec: CodecAudio): string {
  return `.${codec}`
}

/** Il codec di un file dal suo nome, o `null` se non e' un audio trattabile. */
export function codecDaNome(nome: string): CodecAudio | null {
  const ext = nome.toLowerCase().split('.').pop() ?? ''
  if (ext === 'mp3') return 'mp3'
  if (ext === 'm4a') return 'm4a'
  if (ext === 'wav') return 'wav'
  return null
}
