/**
 * Tipi del microservizio media-manager, ricalcati sul contratto OpenAPI.
 *
 * La fonte di verita' e' `openapi/<dominio>/api.yaml` nel repository del
 * servizio: qui si riscrive a mano solo cio' che il client usa davvero,
 * invece di generare tutto. Oggi e' l'archivio (`media`), che l'elaborazione
 * audio usa per depositare le sorgenti e ritirare i prodotti; la composizione
 * di immagini (`content`) vive su un branch dedicato.
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
