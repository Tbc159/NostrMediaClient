import {
  dimensioni,
  mirrorBlob,
  uploadBlob,
  urlConEstensione,
  BlossomError,
  type BlobDescriptor,
  type ImetaInput,
} from '@nmc/nostr-core'

/**
 * Choosing the files, uploading them to Blossom, the metadata.
 *
 * The flow has **three distinct moments**, and keeping them separate is the
 * point:
 *
 *   1. **choosing** — the file stays in the browser, its preview is shown and
 *      its measurements are read. Nothing leaves;
 *   2. **uploading** — only on an explicit confirmation does the file go to
 *      Blossom;
 *   3. **publishing** — a Nostr event that *points* at the file, and that may
 *      never arrive at all.
 *
 * Uploading at the moment of choosing looked quicker and was not: it sent to a
 * remote server a file the user had not yet looked at, and there is no real
 * coming back from Blossom — the blob is identified by its hash and anyone who
 * knows it can download it again.
 *
 * An invariant that stands, from the plan: **if the upload fails no event is
 * published**. An `imeta` pointing at nothing is worse than a missed post — it
 * stays published for ever with a broken image, and kind 20 is regular, hence
 * not correctable.
 */

export type StatoFile = 'in-attesa' | 'in-corso' | 'caricato' | 'errore'

/** A file the user chose, before or after the upload. */
export interface MediaSelezionato {
  /** A stable key for the list: the name is not enough, two identical files can be chosen. */
  id: string
  /** The local file. Absent for the media adopted from an already published event. */
  file: File | null
  nome: string
  mime: string
  dimensioneByte: number
  /** The preview's URL: a local blob before the upload, the remote URL after. */
  anteprima: string
  /** Dimensioni in pixel, misurate localmente. */
  dim?: string
  /** The duration in seconds, for audio and video. */
  duration?: number
  /** A description for whoever cannot see the file. Editable before and after. */
  alt: string
  stato: StatoFile
  errore?: string
  /** Set after the upload. */
  descrittore?: BlobDescriptor
  copie: string[]
}

export type FaseUpload =
  | { fase: 'inattivo' }
  | { fase: 'analisi'; nome: string }
  | { fase: 'invio'; nome: string; server: string }
  | { fase: 'replica'; nome: string; server: string }

/**
 * Measures an image or a video **before** the upload.
 *
 * The dimensions are what let the reader reserve the right space and keep the
 * text from jumping when the image arrives. They have to be read here, from
 * the original file: after the upload it would have to be downloaded again,
 * and a server that recompresses could return different ones.
 */
async function misura(file: File): Promise<{ dim?: string; duration?: number }> {
  if (file.type.startsWith('image/')) {
    try {
      const bitmap = await createImageBitmap(file)
      const risultato = { dim: dimensioni(bitmap.width, bitmap.height) }
      bitmap.close()
      return risultato
    } catch {
      // A format the browser does not decode (old AVIFs, TIFF): it is
      // uploaded all the same, simply without declaring the dimensions.
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

  // Audio has a duration too, and for a podcast episode it is a datum the
  // apps show (itunes:duration): without it the episode's row is left without
  // minutes. It is measured as for videos, from the metadata alone.
  if (file.type.startsWith('audio/')) {
    return new Promise((risolvi) => {
      const audio = document.createElement('audio')
      const url = URL.createObjectURL(file)
      const chiudi = (valore: { duration?: number }): void => {
        URL.revokeObjectURL(url)
        risolvi(valore)
      }
      audio.preload = 'metadata'
      audio.onloadedmetadata = () =>
        chiudi(Number.isFinite(audio.duration) ? { duration: audio.duration } : {})
      audio.onerror = () => chiudi({})
      audio.src = url
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
  /** True when everything that was chosen has made it onto Blossom. */
  const tuttoCaricato = computed(
    () => media.value.length > 0 && media.value.every((m) => m.stato === 'caricato'),
  )

  /** Revokes the locally created previews alone: the remote ones have nothing to free. */
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

  /** Updates a file's accessible description. */
  function descrivi(id: string, alt: string): void {
    const trovato = media.value.find((m) => m.id === id)
    if (trovato) trovato.alt = alt
  }

  /**
   * Takes on the chosen files **without uploading them**.
   *
   * Here they are measured and the preview is built: all locally, nothing
   * leaves the browser. It is the moment at which the user can still change
   * their mind at no cost.
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
   * Uploads the files still waiting to Blossom.
   *
   * Mirroring to the other servers does not block: when it fails, the file
   * stays on the primary. Treating it as an error would throw away a
   * successful upload because a *secondary* server does not answer.
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
        // The name is what chooses the extension in the URL: an «.mp3» stays
        // an «.mp3», instead of the «.mpga» the server would answer with.
        const descrittore = await uploadBlob(primario, m.file, {
          firma: (template) => identita.firma(template),
          pubkey: identita.pubkey ?? '',
          mime: m.mime,
          nome: m.nome,
        })

        const copie = [primario]
        for (const altro of server.value.slice(1)) {
          fase.value = { fase: 'replica', nome: m.nome, server: altro }
          try {
            await mirrorBlob(altro, descrittore.url, descrittore.sha256, {
              firma: (template) => identita.firma(template),
              pubkey: identita.pubkey ?? '',
              mime: m.mime,
              nome: m.nome,
            })
            copie.push(altro)
          } catch {
            // The primary has the file: a missed mirror is less redundancy,
            // not a failed upload.
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

  /** An uploaded file's NIP-92 metadata, ready to become an `imeta` tag. */
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
      // The copies beyond the first become fallbacks: if the primary
      // disappears the published event goes on pointing at something alive.
      ...(m.copie.length > 1
        ? {
            fallback: m.copie
              .slice(1)
              .map((s) => urlConEstensione(`${s}/${m.descrittore?.sha256}`, m.mime, m.nome)),
          }
        : {}),
    }
  }

  /** The `imeta`s of every uploaded file, in the order they were chosen. */
  const imeta = computed<ImetaInput[]>(() =>
    caricati.value.map(imetaDi).filter((x): x is ImetaInput => x !== null),
  )

  /**
   * Adopts files already on Blossom, without re-uploading them.
   *
   * It is what recomposes an event starting from a published one: the files
   * are there already, identified by their hash, and the old event's `imeta`
   * contains everything needed.
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
