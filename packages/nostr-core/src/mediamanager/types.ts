/**
 * Tipi del microservizio media-manager, ricalcati sul contratto OpenAPI.
 *
 * La fonte di verita' e' `openapi/<dominio>/api.yaml` nel repository del
 * servizio: qui si riscrive a mano solo cio' che il client usa davvero,
 * invece di generare tutto. La generazione porterebbe dentro un albero di
 * tipi che nessuno legge e che va rigenerato a ogni modifica del contratto,
 * mentre le poche forme che tocchiamo stanno in una pagina.
 */

/** Un media gia' caricato sul servizio. */
export interface MediaItem {
  id: number
  /** Il titolo **che hai inviato tu**. Non e' un riferimento valido. */
  title: string
  /**
   * Il nome del file, **generato dal servizio**: e' questo il riferimento.
   *
   * La distinzione non e' pedanteria: la risoluzione per stringa guarda solo
   * il `filename`, e passare il `title` produce un 400. Va riletto da qui,
   * perche' non coincide con quello che hai mandato.
   */
  filename: string
  media_type: string
  status?: 'ready' | 'processing' | 'error'
  size_bytes?: number | null
  duration_s?: number | null
  created_at_s?: number
  content_url?: string
  download_url?: string
  /**
   * URL dei byte utilizzabile **senza intestazioni**, a scadenza.
   *
   * E' il campo per `<img src>` e `<audio src>`: il browser non allega la
   * chiave alle sotto-risorse, e `content_url` li' riceve 401. Assente se
   * l'ambiente del servizio non ha una chiave di firma; in quel caso restano
   * i byte scaricati con la chiave.
   */
  signed_url?: string
  signed_url_expires_at_s?: number
}

export interface ElencoMedia {
  items: MediaItem[]
  page: number
  page_size: number
  total?: number
}

/**
 * Riferimento a un asset gia' caricato: l'id numerico oppure il nome del file.
 *
 * Il nome e' risolto in modo tollerante dal servizio — ignora maiuscole,
 * estensione e separatore — e in caso di omonimia vince il piu' recente.
 */
export type RiferimentoMedia = number | string

export type FormatoImmagine = 'image/png' | 'image/jpeg' | 'image/webp'

/** Posizione: parola chiave, percentuale dello spazio libero, oppure pixel. */
export type Posizione = string

export interface Misura {
  width?: string
  height?: string
}

export interface LivelloSfondo {
  type: 'background'
  media?: RiferimentoMedia
  fit?: 'cover' | 'contain' | 'stretch'
  fallback_color?: string
}

export interface LivelloPersona {
  type: 'person'
  media: RiferimentoMedia
  x?: Posizione
  y?: Posizione
  size?: Misura
  opacity?: number
  required?: boolean
}

export interface LivelloTesto {
  type: 'text'
  content: string
  font?: RiferimentoMedia
  font_size?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  x?: Posizione
  y?: Posizione
  max_width?: number | null
  stroke?: { width?: number; color?: string }
  box?: { color: string; radius?: number; padding?: number; opacity?: number }
}

export interface LivelloImmagine {
  type: 'image'
  media: RiferimentoMedia
  x?: Posizione
  y?: Posizione
  size?: Misura
  opacity?: number
  required?: boolean
}

export type Livello = LivelloSfondo | LivelloPersona | LivelloTesto | LivelloImmagine

export interface RichiestaCopertina {
  tipo: 'copertina'
  titolo: string
  testo_centrale: string
  logo_host: RiferimentoMedia
  ospiti?: RiferimentoMedia[]
  colore_sfondo?: string
  tipo_sfondo?: 'unicolor' | 'sfumato-up' | 'sfumato-down'
  colore_sfumato?: string | null
  formato?: FormatoImmagine
  font_titolo?: RiferimentoMedia
  font_testo?: RiferimentoMedia
}

export interface RichiestaComposita {
  tipo: 'composita'
  formato?: FormatoImmagine
  layers: Livello[]
}

/** Preset quadrato 1080x1080 del motore a livelli. */
export interface RichiestaSocial {
  tipo: 'social'
  logo_top: RiferimentoMedia
  logo_bottom: RiferimentoMedia
  testo?: string
  testo_bottom?: string | null
  colore_sfondo?: string
  colore_testo?: string
  formato?: FormatoImmagine
}

export type RichiestaImmagine = RichiestaCopertina | RichiestaComposita | RichiestaSocial

export interface ImmagineGenerata {
  id: number
  tipo: 'copertina' | 'composita' | 'social' | 'slide'
  media_type: FormatoImmagine
  size_bytes?: number | null
  created_at_s: number
  content_url: string
  download_url: string
  /** URL senza intestazioni per l'anteprima. Vedi `MediaItem.signed_url`. */
  signed_url?: string
  signed_url_expires_at_s?: number
  /** Avvisi non bloccanti: font non trovato, livello saltato… La risposta resta 201. */
  warnings?: string[]
}
