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
  title: string
  media_type: string
  size_bytes?: number | null
  duration_s?: number | null
  created_at_s?: number
  content_url?: string
  download_url?: string
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

/** Il generatore `social` esiste nel contratto ma risponde 501: non e' implementato. */
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
  tipo: 'copertina' | 'composita' | 'social'
  media_type: FormatoImmagine
  size_bytes?: number | null
  created_at_s: number
  content_url: string
  download_url: string
  /** Avvisi non bloccanti: font non trovato, livello saltato… La risposta resta 201. */
  warnings?: string[]
}
