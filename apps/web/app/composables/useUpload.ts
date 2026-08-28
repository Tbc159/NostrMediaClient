import {
  dimensioni,
  mirrorBlob,
  uploadBlob,
  BlossomError,
  type BlobDescriptor,
  type ImetaInput,
} from '@nmc/nostr-core'

/**
 * Caricamento di un file su Blossom e costruzione dei suoi metadati.
 *
 * Invariante da rispettare, dal piano: **se il caricamento fallisce non si
 * pubblica alcun evento**. Un `imeta` che punta al vuoto e' peggio di un post
 * mancato — resta pubblicato per sempre con un'immagine rotta, e l'autore non
 * puo' correggerlo perche' il kind 20 e' regolare, quindi immutabile.
 */

/** File caricato, pronto a diventare un tag imeta. */
export interface MediaCaricato {
  /** Nome originale, solo per mostrarlo: Blossom identifica per hash. */
  nome: string
  imeta: ImetaInput
  /** Server che hanno una copia del file, il primo e' quello di `url`. */
  copie: string[]
  anteprima: string
  descrittore: BlobDescriptor
}

export type StatoUpload =
  | { fase: 'inattivo' }
  | { fase: 'analisi'; nome: string }
  | { fase: 'firma'; nome: string }
  | { fase: 'invio'; nome: string; server: string }
  | { fase: 'replica'; nome: string; server: string }
  | { fase: 'fatto' }

/**
 * Misura un'immagine o un video prima del caricamento.
 *
 * Le dimensioni servono a chi legge per riservare lo spazio giusto ed evitare
 * che il testo salti quando l'immagine arriva. Vanno lette qui, dal file
 * originale: dopo l'upload servirebbe riscaricarlo, e un server che ricomprime
 * potrebbe restituirne di diverse.
 */
async function misura(file: File): Promise<{ dim?: string; duration?: number }> {
  if (file.type.startsWith('image/')) {
    try {
      const bitmap = await createImageBitmap(file)
      const risultato = { dim: dimensioni(bitmap.width, bitmap.height) }
      bitmap.close()
      return risultato
    } catch {
      // Formato che il browser non decodifica (AVIF vecchi, TIFF): si carica
      // comunque, semplicemente senza dichiarare le dimensioni.
      return {}
    }
  }

  if (file.type.startsWith('video/')) {
    return new Promise((risolvi) => {
      const video = document.createElement('video')
      const url = URL.createObjectURL(file)
      const chiudi = (valore: { dim?: string; duration?: number }): void => {
        URL.revokeObjectURL(url)
        risolvi(valore)
      }
      video.preload = 'metadata'
      video.onloadedmetadata = () =>
        chiudi({
          dim: dimensioni(video.videoWidth, video.videoHeight),
          duration: Number.isFinite(video.duration) ? video.duration : undefined,
        })
      video.onerror = () => chiudi({})
      video.src = url
    })
  }

  return {}
}

export function useUpload() {
  const identita = useIdentity()
  const config = useClientConfig()

  const stato = ref<StatoUpload>({ fase: 'inattivo' })
  const errore = ref<string | null>(null)
  const caricati = ref<MediaCaricato[]>([])

  const server = computed(() => config.value.blossomServers)
  const inCorso = computed(() => stato.value.fase !== 'inattivo' && stato.value.fase !== 'fatto')

  /** Revoca solo le anteprime create localmente: quelle remote non hanno nulla da liberare. */
  function liberaAnteprima(url: string): void {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }

  function azzera(): void {
    for (const m of caricati.value) liberaAnteprima(m.anteprima)
    caricati.value = []
    errore.value = null
    stato.value = { fase: 'inattivo' }
  }

  function rimuovi(indice: number): void {
    const [tolto] = caricati.value.splice(indice, 1)
    if (tolto) liberaAnteprima(tolto.anteprima)
  }

  /**
   * Carica un file sul primo server e ne chiede la replica agli altri.
   *
   * La replica non blocca: se fallisce, il file resta comunque disponibile sul
   * primario. Trattarla come un errore significherebbe buttare un caricamento
   * riuscito perche' un server *secondario* non risponde.
   */
  async function carica(file: File): Promise<MediaCaricato | null> {
    errore.value = null

    if (!identita.puoFirmare) {
      errore.value =
        identita.motivoNonFirmabile ??
        'Serve un’identità che possa firmare: Blossom autorizza il caricamento con un evento firmato.'
      return null
    }
    const primario = server.value[0]
    if (!primario) {
      errore.value = 'Nessun server Blossom configurato. Impostane uno dalle impostazioni.'
      return null
    }

    try {
      stato.value = { fase: 'analisi', nome: file.name }
      const misure = await misura(file)

      stato.value = { fase: 'invio', nome: file.name, server: primario }
      const descrittore = await uploadBlob(primario, file, {
        firma: (template) => identita.firma(template),
        pubkey: identita.pubkey ?? '',
        mime: file.type || 'application/octet-stream',
      })

      const copie = [primario]
      for (const altro of server.value.slice(1)) {
        stato.value = { fase: 'replica', nome: file.name, server: altro }
        try {
          await mirrorBlob(altro, descrittore.url, descrittore.sha256, {
            firma: (template) => identita.firma(template),
            pubkey: identita.pubkey ?? '',
          })
          copie.push(altro)
        } catch {
          // Il primario ha il file: una replica mancata e' meno ridondanza,
          // non un caricamento fallito.
        }
      }

      const media: MediaCaricato = {
        nome: file.name,
        descrittore,
        copie,
        anteprima: URL.createObjectURL(file),
        imeta: {
          url: descrittore.url,
          mime: descrittore.type || file.type,
          sha256: descrittore.sha256,
          size: descrittore.size,
          ...(misure.dim ? { dim: misure.dim } : {}),
          ...(misure.duration !== undefined ? { duration: misure.duration } : {}),
          // Le copie oltre la prima diventano fallback: se il primario sparisce
          // l'evento gia' pubblicato continua a puntare a qualcosa di vivo.
          ...(copie.length > 1
            ? { fallback: copie.slice(1).map((s) => `${s}/${descrittore.sha256}`) }
            : {}),
        },
      }

      caricati.value = [...caricati.value, media]
      stato.value = { fase: 'fatto' }
      return media
    } catch (e) {
      stato.value = { fase: 'inattivo' }
      errore.value =
        e instanceof BlossomError ? e.message : e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Carica piu' file uno dopo l'altro, fermandosi al primo che fallisce. */
  async function caricaTutti(files: FileList | File[]): Promise<boolean> {
    for (const file of Array.from(files)) {
      if (!(await carica(file))) return false
    }
    return true
  }

  /**
   * Adotta file gia' presenti su Blossom, senza ricaricarli.
   *
   * Serve a ricomporre un evento partendo da uno pubblicato: i file sono gia'
   * la', identificati dal loro hash, e l'`imeta` dell'evento vecchio contiene
   * tutto quello che serve. Riscaricarli per rimandarli sarebbe traffico
   * inutile e produrrebbe comunque lo stesso hash.
   *
   * L'anteprima punta all'URL remoto e non a un blob locale: non c'e' nessun
   * `createObjectURL` da revocare, e infatti `azzera` li lascia stare.
   */
  function adotta(media: MediaCaricato[]): void {
    caricati.value = media
    stato.value = { fase: 'fatto' }
  }

  /** Aggiorna la descrizione accessibile di un file gia' caricato. */
  function descrivi(indice: number, alt: string): void {
    const media = caricati.value[indice]
    if (media) media.imeta = { ...media.imeta, alt: alt.trim() || undefined }
  }

  onBeforeUnmount(() => {
    for (const m of caricati.value) liberaAnteprima(m.anteprima)
  })

  return {
    stato,
    errore,
    caricati,
    server,
    inCorso,
    carica,
    caricaTutti,
    adotta,
    rimuovi,
    descrivi,
    azzera,
  }
}
