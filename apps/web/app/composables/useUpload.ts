import {
  dimensioni,
  mirrorBlob,
  uploadBlob,
  BlossomError,
  type BlobDescriptor,
  type ImetaInput,
} from '@nmc/nostr-core'

/**
 * Selezione dei file, caricamento su Blossom, metadati.
 *
 * Il flusso ha **tre momenti distinti**, e tenerli separati e' il punto:
 *
 *   1. **selezione** — il file resta nel browser, se ne vede l'anteprima e se
 *      ne leggono le misure. Non esce nulla;
 *   2. **caricamento** — solo su conferma esplicita il file va su Blossom;
 *   3. **pubblicazione** — un evento Nostr che *punta* al file, e che puo'
 *      anche non arrivare mai.
 *
 * Caricare al momento della scelta sembrava piu' rapido e non lo era: mandava
 * su un server remoto un file che l'utente non aveva ancora guardato, e da
 * Blossom non si torna indietro davvero — il blob e' identificato dal suo hash
 * e chiunque lo conosca puo' riscaricarlo.
 *
 * Invariante che resta, dal piano: **se il caricamento fallisce non si pubblica
 * alcun evento**. Un `imeta` che punta al vuoto e' peggio di un post mancato —
 * resta pubblicato per sempre con un'immagine rotta, e il kind 20 e' regolare,
 * quindi non correggibile.
 */

export type StatoFile = 'in-attesa' | 'in-corso' | 'caricato' | 'errore'

/** Un file scelto dall'utente, prima o dopo il caricamento. */
export interface MediaSelezionato {
  /** Chiave stabile per l'elenco: il nome non basta, si possono scegliere due file uguali. */
  id: string
  /** Il file locale. Assente per i media adottati da un evento gia' pubblicato. */
  file: File | null
  nome: string
  mime: string
  dimensioneByte: number
  /** URL dell'anteprima: un blob locale prima del caricamento, l'URL remoto dopo. */
  anteprima: string
  /** Dimensioni in pixel, misurate localmente. */
  dim?: string
  /** Durata in secondi, per audio e video. */
  duration?: number
  /** Descrizione per chi non vede il file. Modificabile prima e dopo. */
  alt: string
  stato: StatoFile
  errore?: string
  /** Valorizzati dopo il caricamento. */
  descrittore?: BlobDescriptor
  copie: string[]
}

export type FaseUpload =
  | { fase: 'inattivo' }
  | { fase: 'analisi'; nome: string }
  | { fase: 'invio'; nome: string; server: string }
  | { fase: 'replica'; nome: string; server: string }

/**
 * Misura un'immagine o un video **prima** del caricamento.
 *
 * Le dimensioni servono a chi legge per riservare lo spazio giusto ed evitare
 * che il testo salti quando l'immagine arriva. Vanno lette qui, dal file
 * originale: dopo il caricamento servirebbe riscaricarlo, e un server che
 * ricomprime potrebbe restituirne di diverse.
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

  const media = ref<MediaSelezionato[]>([])
  const fase = ref<FaseUpload>({ fase: 'inattivo' })
  const errore = ref<string | null>(null)

  const server = computed(() => config.value.blossomServers)
  const inCorso = computed(() => fase.value.fase !== 'inattivo')

  const daCaricare = computed(() => media.value.filter((m) => m.stato !== 'caricato'))
  const caricati = computed(() => media.value.filter((m) => m.stato === 'caricato'))
  const nessunoSelezionato = computed(() => media.value.length === 0)
  /** Vero quando tutto quello che era stato scelto e' finito su Blossom. */
  const tuttoCaricato = computed(
    () => media.value.length > 0 && media.value.every((m) => m.stato === 'caricato'),
  )

  /** Revoca solo le anteprime create localmente: quelle remote non hanno nulla da liberare. */
  function liberaAnteprima(url: string): void {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }

  function azzera(): void {
    for (const m of media.value) liberaAnteprima(m.anteprima)
    media.value = []
    errore.value = null
    fase.value = { fase: 'inattivo' }
  }

  function rimuovi(id: string): void {
    const trovato = media.value.find((m) => m.id === id)
    if (trovato) liberaAnteprima(trovato.anteprima)
    media.value = media.value.filter((m) => m.id !== id)
  }

  /** Aggiorna la descrizione accessibile di un file. */
  function descrivi(id: string, alt: string): void {
    const trovato = media.value.find((m) => m.id === id)
    if (trovato) trovato.alt = alt
  }

  /**
   * Prende in carico i file scelti **senza caricarli**.
   *
   * Qui si misura e si costruisce l'anteprima: tutto in locale, niente esce dal
   * browser. E' il momento in cui l'utente puo' ancora cambiare idea a costo
   * zero.
   */
  async function seleziona(files: FileList | File[]): Promise<void> {
    errore.value = null
    for (const file of Array.from(files)) {
      fase.value = { fase: 'analisi', nome: file.name }
      const misure = await misura(file)
      media.value = [
        ...media.value,
        {
          id: `${file.name}-${file.size}-${file.lastModified}-${media.value.length}`,
          file,
          nome: file.name,
          mime: file.type || 'application/octet-stream',
          dimensioneByte: file.size,
          anteprima: URL.createObjectURL(file),
          ...(misure.dim ? { dim: misure.dim } : {}),
          ...(misure.duration !== undefined ? { duration: misure.duration } : {}),
          alt: '',
          stato: 'in-attesa',
          copie: [],
        },
      ]
    }
    fase.value = { fase: 'inattivo' }
  }

  /**
   * Carica su Blossom i file ancora in attesa.
   *
   * La replica sugli altri server non blocca: se fallisce, il file resta sul
   * primario. Trattarla come un errore butterebbe un caricamento riuscito
   * perche' un server *secondario* non risponde.
   */
  async function caricaSelezionati(): Promise<boolean> {
    errore.value = null

    if (!identita.puoFirmare) {
      errore.value =
        identita.motivoNonFirmabile ??
        'Serve un’identità che possa firmare: Blossom autorizza il caricamento con un evento firmato.'
      return false
    }
    const primario = server.value[0]
    if (!primario) {
      errore.value = 'Nessun server Blossom configurato. Impostane uno dalle impostazioni.'
      return false
    }

    let tutti = true
    for (const m of media.value) {
      if (m.stato === 'caricato' || !m.file) continue

      m.stato = 'in-corso'
      delete m.errore
      try {
        fase.value = { fase: 'invio', nome: m.nome, server: primario }
        const descrittore = await uploadBlob(primario, m.file, {
          firma: (template) => identita.firma(template),
          pubkey: identita.pubkey ?? '',
          mime: m.mime,
        })

        const copie = [primario]
        for (const altro of server.value.slice(1)) {
          fase.value = { fase: 'replica', nome: m.nome, server: altro }
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

        m.descrittore = descrittore
        m.copie = copie
        m.stato = 'caricato'
      } catch (e) {
        m.stato = 'errore'
        m.errore =
          e instanceof BlossomError ? e.message : e instanceof Error ? e.message : String(e)
        tutti = false
      }
    }

    fase.value = { fase: 'inattivo' }
    if (!tutti) {
      errore.value =
        'Almeno un file non è stato caricato. Quelli riusciti restano su Blossom: puoi riprovare solo i falliti.'
    }
    return tutti
  }

  /** Metadati NIP-92 di un file caricato, pronti a diventare un tag `imeta`. */
  function imetaDi(m: MediaSelezionato): ImetaInput | null {
    if (!m.descrittore) return null
    return {
      url: m.descrittore.url,
      mime: m.descrittore.type || m.mime,
      sha256: m.descrittore.sha256,
      size: m.descrittore.size,
      ...(m.dim ? { dim: m.dim } : {}),
      ...(m.duration !== undefined ? { duration: m.duration } : {}),
      ...(m.alt.trim() ? { alt: m.alt.trim() } : {}),
      // Le copie oltre la prima diventano fallback: se il primario sparisce
      // l'evento gia' pubblicato continua a puntare a qualcosa di vivo.
      ...(m.copie.length > 1
        ? { fallback: m.copie.slice(1).map((s) => `${s}/${m.descrittore?.sha256}`) }
        : {}),
    }
  }

  /** Gli `imeta` di tutti i file caricati, nell'ordine in cui sono stati scelti. */
  const imeta = computed<ImetaInput[]>(() =>
    caricati.value.map(imetaDi).filter((x): x is ImetaInput => x !== null),
  )

  /**
   * Adotta file gia' presenti su Blossom, senza ricaricarli.
   *
   * Serve a ricomporre un evento partendo da uno pubblicato: i file sono gia'
   * la', identificati dal loro hash, e l'`imeta` dell'evento vecchio contiene
   * tutto quello che serve.
   */
  function adotta(
    esistenti: { nome: string; imeta: ImetaInput; descrittore: BlobDescriptor; copie: string[] }[],
  ): void {
    media.value = esistenti.map((e, i) => ({
      id: `adottato-${e.descrittore.sha256}-${i}`,
      file: null,
      nome: e.nome,
      mime: e.imeta.mime ?? e.descrittore.type,
      dimensioneByte: e.descrittore.size,
      anteprima: e.imeta.url,
      ...(e.imeta.dim ? { dim: e.imeta.dim } : {}),
      ...(e.imeta.duration !== undefined ? { duration: e.imeta.duration } : {}),
      alt: e.imeta.alt ?? '',
      stato: 'caricato' as const,
      descrittore: e.descrittore,
      copie: e.copie,
    }))
  }

  onBeforeUnmount(() => {
    for (const m of media.value) liberaAnteprima(m.anteprima)
  })

  return {
    media,
    fase,
    errore,
    server,
    inCorso,
    daCaricare,
    caricati,
    imeta,
    nessunoSelezionato,
    tuttoCaricato,
    seleziona,
    caricaSelezionati,
    rimuovi,
    descrivi,
    adotta,
    azzera,
  }
}
