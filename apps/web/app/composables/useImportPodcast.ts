import {
  BlossomError,
  PIATTAFORME,
  TIPO_AUDIO,
  TIPO_TESTO,
  leggiFeedEsterno,
  paginaDiPiattaforma,
  podcastEpisodeDefinition,
  podcastMetadataDefinition,
  scaricaFile,
  scaricaImmagine,
  urlShowSu,
  type EpisodioImportato,
  type EsitoImport,
  type FileAllegato,
  type NostrEvent,
  type PodcastEpisodeInput,
  type PodcastMetadataInput,
  type PodcastMetadataParsed,
  type RisultatoPubblicazione,
  type TipoPodcast,
  type Valore,
} from '@nmc/nostr-core'

import type { SceltaChiave } from '~/composables/useChiaveDedicata'
import { useMediaManager } from '~/stores/mediamanager'

/**
 * The safety limit of one import: what is copied to Blossom in one go. Above
 * it the import proceeds in batches. Fixed for now, and read from this one
 * place only: the service is meant to set it later.
 */
export const LIMITE_IMPORT_BYTE = 2 * 1024 ** 3

/**
 * Moving a podcast to NMC from another host.
 *
 * The steps, in the order the page walks them: read the old feed; stop if its
 * owner has locked it; preview what will be carried and what will not; look at
 * the card already on this key, if any; publish the card with the inherited
 * identity; publish the episodes, copying their files to Blossom or keeping the
 * original URLs, one at a time and skipping the ones already imported.
 *
 * Nothing is lost silently: what cannot be carried is listed before anything
 * is published. An episode whose audio or image cannot be copied waits instead
 * of going out with the old host's address: it is signed only once the file is
 * on Blossom — attached by hand, or copied on a later run — or once the user
 * chooses to keep the original URL. So every episode is published once, and
 * never needs a second version just to change its file.
 */

export type ModoFile = 'copia' | 'originale'

export type StatoEpisodioImport =
  'in-attesa' | 'gia-presente' | 'in-corso' | 'in-attesa-file' | 'pubblicato' | 'saltato' | 'errore'

/** The files an episode is waiting for, each with the reason the copy failed. */
export interface FileMancanti {
  audio?: string
  immagine?: string
}

/**
 * The files already on Blossom for an episode: copied by a run, or attached by
 * hand. `immagine: null` is the choice to go without an image of its own.
 */
export interface FileAllegati {
  audio?: { url: string; mime: string }
  immagine?: string | null
}

export interface AvanzamentoEpisodio {
  stato: StatoEpisodioImport
  /** What happened, in words: a file kept at its original address and why, an error. */
  note: string[]
  /** For an episode waiting for its files: which ones, and why the copy failed. */
  mancanti?: FileMancanti
  esito?: RisultatoPubblicazione
}

/** Thrown while building an episode whose files are not on Blossom yet. */
class InAttesaDelFile extends Error {
  constructor(readonly mancanti: FileMancanti) {
    super('In attesa del file.')
  }
}

/** The editable fields of the card, prefilled from the import. */
export interface CampiScheda {
  titolo: string
  descrizione: string
  immagine: string
  lingua: string
  email: string
  autore: string
  tipo: TipoPodcast
  categoria: { principale: string; sotto?: string } | null
}

/** An episode's key: its GUID, or — without one — its title and date. */
export const chiaveEpisodio = (e: EpisodioImportato): string =>
  e.guid ?? `${e.titolo}|${e.publishedAt ?? ''}`

const nomeDaUrl = (url: string, ripiego: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || ripiego)
  } catch {
    return ripiego
  }
}

export function useImportPodcast() {
  const identita = useIdentity()
  const servizio = useMediaManager()
  const blossom = useBlossom()
  const invio = usePublish()
  const esistente = useEventoEsistente()
  const propri = useEventiPropri([54], { limite: 500 })
  const scheda = useEventDraft()
  const conservati = useTagConservati(() => [])

  const urlFonte = ref('')
  const lettura = ref<EsitoImport | null>(null)
  const errore = ref<string | null>(null)
  const inLettura = ref(false)

  const aperto = computed(() => (lettura.value && !lettura.value.bloccato ? lettura.value : null))

  // ── 1. reading ─────────────────────────────────────────────────────────

  async function leggiTesto(xml: string, url?: string): Promise<void> {
    errore.value = null
    try {
      lettura.value = await leggiFeedEsterno(xml, url || undefined)
      if (!lettura.value.bloccato) preparaScelte(lettura.value)
    } catch (e) {
      lettura.value = null
      errore.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function leggiUrl(url: string): Promise<void> {
    errore.value = null
    urlFonte.value = url.trim()
    inLettura.value = true
    try {
      // A show's page fails like a feed without CORS: say what it is instead.
      const pagina = paginaDiPiattaforma(urlFonte.value)
      if (pagina) throw new Error(pagina)
      let risposta: Response
      try {
        risposta = await fetch(urlFonte.value, { mode: 'cors' })
      } catch {
        throw new Error(
          'Il browser non può leggere questo feed: il server non lo permette da un’altra pagina (CORS). Apri l’indirizzo in una scheda, salva il file .xml e caricalo qui, oppure incollane il contenuto.',
        )
      }
      if (!risposta.ok) throw new Error(`Il server del feed ha risposto ${risposta.status}.`)
      await leggiTesto(await risposta.text(), urlFonte.value)
    } catch (e) {
      lettura.value = null
      errore.value = e instanceof Error ? e.message : String(e)
    } finally {
      inLettura.value = false
    }
  }

  // ── 2. the choices of the preview ──────────────────────────────────────

  const modoFile = ref<ModoFile>('copia')
  /** Episodes that keep their original URLs whatever the general choice. */
  const originaliPerEpisodio = ref(new Set<string>())
  /** The indices of the show's split recipients to drop. */
  const destinatariEsclusi = ref(new Set<number>())
  /** The episodes chosen for this batch, by key. */
  const lotto = ref(new Set<string>())
  /** The show's links on the platforms where it already is, by platform id. */
  const giaDistribuito = ref<Record<string, string>>({})

  const campi = reactive<CampiScheda>({
    titolo: '',
    descrizione: '',
    immagine: '',
    lingua: '',
    email: '',
    autore: '',
    tipo: 'episodic',
    categoria: null,
  })

  const limite = computed(() => LIMITE_IMPORT_BYTE)

  /** The episodes that can become a kind 54: the ones with an audio file. */
  const importabili = computed(() => aperto.value?.episodi.filter((e) => e.audio) ?? [])

  const copiaPer = (e: EpisodioImportato): boolean =>
    modoFile.value === 'copia' && !originaliPerEpisodio.value.has(chiaveEpisodio(e))

  /** The bytes this batch would copy to Blossom. */
  const pesoLotto = computed(() =>
    importabili.value
      .filter((e) => lotto.value.has(chiaveEpisodio(e)) && copiaPer(e))
      .reduce((t, e) => t + (e.audio?.peso ?? 0), 0),
  )
  const superaLimite = computed(() => pesoLotto.value > limite.value)

  /**
   * The most recent episodes that fit in the limit.
   *
   * The newest first, because they are the ones the listeners are on now; the
   * order of import does not matter, since the feed's dates come from
   * `published_at`.
   */
  function lottoNelLimite(): Set<string> {
    const scelti = new Set<string>()
    let totale = 0
    for (const e of [...importabili.value].reverse()) {
      const peso = copiaPer(e) ? (e.audio?.peso ?? 0) : 0
      if (totale + peso > limite.value) continue
      totale += peso
      scelti.add(chiaveEpisodio(e))
    }
    return scelti
  }

  function preparaScelte(esito: Extract<EsitoImport, { bloccato: false }>): void {
    const p = esito.podcast
    Object.assign(campi, {
      titolo: p.titolo,
      descrizione: p.descrizione,
      immagine: p.immagine ?? '',
      lingua: p.lingua ?? '',
      email: p.email ?? '',
      autore: p.autore ?? '',
      tipo: p.tipo ?? 'episodic',
      categoria: p.categoria ?? null,
    })
    originaliPerEpisodio.value = new Set(
      // Without a GUID the apps know an episode by its audio URL: copying it
      // would make it look new, so it keeps the original by default.
      esito.episodi.filter((e) => !e.guid).map(chiaveEpisodio),
    )
    // The recipients marked as a fee are, nearly always, the old host.
    destinatariEsclusi.value = new Set(
      (p.valore?.destinatari ?? []).flatMap((d, i) => (d.fee ? [i] : [])),
    )
    lotto.value = new Set(esito.episodi.filter((e) => e.audio).map(chiaveEpisodio))
    if (superaLimite.value) lotto.value = lottoNelLimite()
  }

  function proponiLottoNelLimite(): void {
    lotto.value = lottoNelLimite()
  }

  /** The show's split without the recipients the user dropped. */
  const valoreScheda = computed<Valore | undefined>(() => {
    const v = aperto.value?.podcast.valore
    if (!v) return undefined
    const destinatari = v.destinatari.filter((_, i) => !destinatariEsclusi.value.has(i))
    return destinatari.length ? { ...v, destinatari } : undefined
  })

  // ── 3. the card already on this key ────────────────────────────────────

  const schedaEsistente = ref<NostrEvent | null>(null)
  const datiEsistenti = ref<PodcastMetadataParsed | null>(null)
  /** The user's answer to «is this card already on a platform?», for a card with no signs. */
  const rispostaDistribuita = ref<'si' | 'no' | null>(null)
  /** The user's answer to «are this card's platform links the show being imported?». */
  const linkDelloShow = ref<'si' | 'no' | null>(null)

  async function controllaScheda(): Promise<void> {
    schedaEsistente.value = null
    datiEsistenti.value = null
    conservati.azzera()
    const trovata = await esistente.perCoordinata(10154)
    if (!trovata) return
    schedaEsistente.value = trovata
    try {
      datiEsistenti.value = podcastMetadataDefinition.parse(trovata)
      conservati.fotografa(podcastMetadataDefinition, trovata, datiEsistenti.value)
    } catch {
      datiEsistenti.value = null
    }
  }

  /**
   * The card on this key is this very show: it has the same `podcast:guid`.
   *
   * A second run, or a second batch: the import resumes, publishing the
   * episodes that are missing, and leaves the card as it is.
   */
  const stessoShow = computed(() => {
    const qui = datiEsistenti.value?.podcastGuid
    return !!qui && qui === aperto.value?.podcast.podcastGuid
  })

  /** The platforms the existing card links to, by name. */
  const linkPiattaforme = computed(() => {
    const d = datiEsistenti.value
    return d ? PIATTAFORME.filter((p) => urlShowSu(p, d.websites)).map((p) => p.nome) : []
  })

  /** The signs that the existing card is a podcast already out there. */
  const segniDistribuzione = computed<string[]>(() => {
    const d = datiEsistenti.value
    if (!d) return []
    return [
      ...(d.feedUrl ? [`ha già un indirizzo del feed (${d.feedUrl})`] : []),
      ...linkPiattaforme.value.map((nome) => `ha un link a ${nome}`),
    ]
  })

  /**
   * Whether the existing card must be protected from being replaced.
   *
   * In doubt it is: replacing a podcast that is out there would turn it into
   * another one for every app that follows it, and there is no undoing that.
   * A stable address settles it. Platform links alone do not: a card made by
   * hand for a show still on its old host carries that show's own links, and
   * only the creator knows which of the two it is, so the creator is asked.
   */
  const schedaProtetta = computed(() => {
    if (!schedaEsistente.value || stessoShow.value) return false
    if (datiEsistenti.value?.feedUrl) return true
    if (linkPiattaforme.value.length > 0) return linkDelloShow.value !== 'si'
    return rispostaDistribuita.value !== 'no'
  })

  /** Protected beyond doubt: the card is another podcast out there. */
  const distribuitaCerta = computed(
    () =>
      schedaProtetta.value &&
      (!!datiEsistenti.value?.feedUrl ||
        (linkPiattaforme.value.length > 0
          ? linkDelloShow.value === 'no'
          : rispostaDistribuita.value === 'si')),
  )

  /** Why the active key cannot take this podcast, for the key's question. */
  const bloccoQuesta = computed<string | null>(() => {
    if (!schedaProtetta.value) return null
    const titolo = datiEsistenti.value?.title ?? 'senza titolo'
    if (
      distribuitaCerta.value &&
      linkPiattaforme.value.length === 0 &&
      !datiEsistenti.value?.feedUrl
    ) {
      return `Ha già la scheda «${titolo}», pubblicata su qualche piattaforma: un secondo podcast non ci sta.`
    }
    if (distribuitaCerta.value) {
      return `Ha già la scheda «${titolo}», distribuita: un secondo podcast non ci sta.`
    }
    return `Ha già la scheda «${titolo}»: rispondi prima alla domanda qui sopra.`
  })

  // ── 3b. which key ──────────────────────────────────────────────────────

  /** The answer to «which key does the podcast live on». */
  const sceltaChiave = ref<SceltaChiave | null>(null)
  /** When a dedicated key was created: the key, and the personal one to name as host. */
  const dedicata = ref<{ pubkey: string; autore: string } | null>(null)

  // The show already living on this key answers the question by itself.
  const chiavePronta = computed(
    () =>
      stessoShow.value ||
      sceltaChiave.value === 'questa' ||
      (!!dedicata.value && dedicata.value.pubkey === identita.pubkey),
  )

  function chiaveDedicataCreata(dati: { pubkey: string; autore: string }): void {
    dedicata.value = dati
  }

  // Another key, another card: what was read and published for the previous
  // one does not hold for this one.
  watch(
    () => identita.pubkey,
    (pubkey) => {
      scheda.azzera()
      noteScheda.value = []
      avanzamento.value = {}
      rispostaDistribuita.value = null
      linkDelloShow.value = null
      if (dedicata.value?.pubkey !== pubkey) {
        dedicata.value = null
        sceltaChiave.value = null
      }
      if (aperto.value) void controllaScheda()
    },
  )

  /** The kind 54s already on this key, parsed once. */
  const episodiPropri = computed(() =>
    propri.eventi.value.flatMap((e) => {
      try {
        return [podcastEpisodeDefinition.parse(e)]
      } catch {
        // A malformed episode from another client: not ours to match.
        return []
      }
    }),
  )

  /**
   * How an episode already on the key is recognised: by its original GUID, or
   * — when the old feed had none — by its title and first publication date,
   * which the import writes as they were.
   */
  const giaPubblicati = computed(() => {
    const chiavi = new Set<string>()
    for (const p of episodiPropri.value) {
      if (p.guidOriginale) chiavi.add(p.guidOriginale)
      else chiavi.add(`${p.title}|${p.publishedAt ?? ''}`)
    }
    return chiavi
  })

  const giaPresente = (e: EpisodioImportato): boolean => giaPubblicati.value.has(chiaveEpisodio(e))

  /** The episodes born on this key outside the import: they will share the feed. */
  const episodiNativi = computed(() => {
    const importati = new Set(aperto.value?.episodi.map(chiaveEpisodio) ?? [])
    return episodiPropri.value.filter(
      (p) => !p.guidOriginale && !importati.has(`${p.title}|${p.publishedAt ?? ''}`),
    )
  })

  // ── 4. publishing the card ─────────────────────────────────────────────

  function inputScheda(): PodcastMetadataInput {
    const importato = aperto.value?.podcast
    const prima = datiEsistenti.value
    const siti = [
      ...(importato?.sito ? [importato.sito] : []),
      ...(prima?.websites ?? []),
      ...Object.values(giaDistribuito.value).map((u) => u.trim()),
    ].filter((u, i, tutti) => u !== '' && tutti.indexOf(u) === i)

    // On a dedicated key the personal one is the host: the half of the link the
    // card writes, the other half being the 10064 it published.
    const host = dedicata.value?.pubkey === identita.pubkey ? dedicata.value.autore : null
    const autori = [
      ...(prima?.authors ?? []),
      ...(host && !prima?.authors.some((a) => a.pubkey === host)
        ? [{ pubkey: host, role: 'host' }]
        : []),
    ]

    return {
      title: campi.titolo,
      description: campi.descrizione,
      image: campi.immagine,
      websites: siti,
      ...(autori.length ? { authors: autori } : {}),
      ...(campi.categoria ? { categories: [campi.categoria] } : {}),
      ...(campi.lingua ? { language: campi.lingua } : {}),
      ...(campi.email ? { email: campi.email } : {}),
      ...(importato?.explicit ? { contentWarning: '' } : {}),
      // The identity comes from the old host, never from this card: it is what
      // the apps know the show by.
      ...(importato?.podcastGuid ? { podcastGuid: importato.podcastGuid } : {}),
      ...(prima?.feedUrl ? { feedUrl: prima.feedUrl } : {}),
      ...(campi.autore ? { autore: campi.autore } : {}),
      tipo: campi.tipo,
      ...(valoreScheda.value ? { valore: valoreScheda.value } : {}),
      persone: importato?.persone.length ? importato.persone : (prima?.persone ?? []),
      finanziamenti: importato?.finanziamenti.length
        ? importato.finanziamenti
        : (prima?.finanziamenti ?? []),
    }
  }

  /** What happened to the cover, when it could not be copied. */
  const noteScheda = ref<string[]>([])
  /** From the cover's copy to the relays' answer: signing alone is only the end of it. */
  const inScheda = ref(false)

  async function pubblicaScheda(): Promise<boolean> {
    if (inScheda.value) return false
    inScheda.value = true
    try {
      return await preparaEPubblicaScheda()
    } finally {
      inScheda.value = false
    }
  }

  /**
   * Copies the show's cover to Blossom, when the files are being copied.
   *
   * Left on the old host, the cover would break the day that account is
   * closed. Called before the card is built, and before a dedicated key's
   * profile is published so that it gets the copy too.
   */
  async function copiaCopertina(): Promise<{ immagine: string }> {
    const giaSuBlossom = blossom.server.value.some((s) => campi.immagine.startsWith(s))
    if (modoFile.value === 'copia' && campi.immagine && !giaSuBlossom) {
      noteScheda.value = []
      try {
        // The card is replaceable: a cover left on the old host can be changed
        // later without a second version, so it does not hold the card back.
        const r = await sistemaFile(campi.immagine, 'immagine', { copia: true })
        if (r.nonCopiato) {
          noteScheda.value.push(
            `${nomeDaUrl(campi.immagine, 'immagine')} resta all’indirizzo originale: ${r.nonCopiato}`,
          )
        }
        campi.immagine = r.url
      } finally {
        fase.value = null
      }
    }
    return { immagine: campi.immagine }
  }

  async function preparaEPubblicaScheda(): Promise<boolean> {
    if (!chiavePronta.value) {
      scheda.errore.value = 'Scegli prima su quale chiave vive il podcast.'
      return false
    }
    if (stessoShow.value) {
      scheda.errore.value =
        'La scheda su questa chiave è già quella di questo show: si importano solo gli episodi che mancano.'
      return false
    }
    if (schedaProtetta.value) {
      scheda.errore.value = distribuitaCerta.value
        ? 'La scheda già presente risulta distribuita: due podcast non stanno su una chiave. Importa su una chiave dedicata.'
        : 'Questa chiave ha già una scheda podcast: rispondi alla domanda sulla scheda, oppure importa su una chiave dedicata. Sostituire un podcast distribuito lo trasformerebbe in un altro.'
      return false
    }
    await copiaCopertina()
    if (
      !scheda.costruisci(podcastMetadataDefinition, inputScheda(), {
        aggiuntivi: conservati.tags.value,
      })
    ) {
      return false
    }
    return scheda.firmaEPubblica()
  }

  // ── 5. publishing the episodes ─────────────────────────────────────────

  const avanzamento = ref<Record<string, AvanzamentoEpisodio>>({})
  const inImport = ref(false)
  const fase = ref<string | null>(null)

  const allegati = ref<Record<string, FileAllegati>>({})

  /** The episodes of this run waiting for a file: they block the redirect. */
  const inAttesaDelFile = computed(() =>
    importabili.value.filter(
      (e) => avanzamento.value[chiaveEpisodio(e)]?.stato === 'in-attesa-file',
    ),
  )
  // Shared with the platforms card, which warns while some are waiting.
  const attesaCondivisa = useState<Record<string, number>>('import-in-attesa-file', () => ({}))
  watch(
    () => [identita.pubkey, inAttesaDelFile.value.length] as const,
    ([pk, n]) => {
      if (pk) attesaCondivisa.value = { ...attesaCondivisa.value, [pk]: n }
    },
  )

  /**
   * One file onto Blossom, or its original URL with the reason it was not
   * copied: a full server, a paid one, a host that will not let the browser
   * read it. The caller decides what that means for the episode.
   */
  async function sistemaFile(
    url: string,
    tipo: 'audio' | 'immagine' | 'testo',
    opzioni: { mime?: string; peso?: number; copia: boolean },
  ): Promise<{ url: string; mime?: string; nonCopiato?: string }> {
    const originale = { url, ...(opzioni.mime ? { mime: opzioni.mime } : {}) }
    if (!opzioni.copia) return originale

    if (opzioni.peso) {
      const prima = await blossom.chiedi(opzioni.peso, opzioni.mime ?? 'application/octet-stream')
      if (prima.esito === 'rifiutato') return { ...originale, nonCopiato: prima.motivo }
    }
    try {
      fase.value = `Scarico ${nomeDaUrl(url, tipo)}…`
      const opzioniDownload = { mediaManager: servizio.client }
      const { blob } =
        tipo === 'immagine'
          ? await scaricaImmagine(url, opzioniDownload)
          : await scaricaFile(url, tipo === 'audio' ? TIPO_AUDIO : TIPO_TESTO, opzioniDownload)
      const mime = opzioni.mime ?? (blob.type || 'application/octet-stream')
      const { descrittore } = await blossom.carica(
        blob,
        { mime, nome: nomeDaUrl(url, tipo) },
        (passo, server) => {
          fase.value = `${passo === 'invio' ? 'Carico' : 'Replico'} ${nomeDaUrl(url, tipo)} su ${server}…`
        },
      )
      return { url: descrittore.url, mime }
    } catch (e) {
      const motivo =
        e instanceof BlossomError ? e.message : e instanceof Error ? e.message : String(e)
      return { ...originale, nonCopiato: motivo }
    }
  }

  /** A transcript or chapters file: not worth holding an episode back for. */
  async function sistemaTesto(
    file: FileAllegato,
    copia: boolean,
    note: string[],
  ): Promise<FileAllegato> {
    const r = await sistemaFile(file.url, 'testo', {
      copia,
      ...(file.mime ? { mime: file.mime } : {}),
    })
    if (r.nonCopiato) {
      note.push(`${nomeDaUrl(file.url, 'testo')} resta all’indirizzo originale: ${r.nonCopiato}`)
    }
    return { url: r.url, ...(r.mime ? { mime: r.mime } : {}) }
  }

  async function inputEpisodio(e: EpisodioImportato, note: string[]): Promise<PodcastEpisodeInput> {
    const copia = copiaPer(e)
    const chiave = chiaveEpisodio(e)
    const giaQui = (): FileAllegati => allegati.value[chiave] ?? {}
    const ricorda = (pezzo: FileAllegati): void => {
      allegati.value = { ...allegati.value, [chiave]: { ...giaQui(), ...pezzo } }
    }
    const mancanti: FileMancanti = {}

    let audio: { url: string; mime?: string }
    const audioAllegato = giaQui().audio
    if (audioAllegato) {
      audio = audioAllegato
    } else {
      const r = await sistemaFile(e.audio!.url, 'audio', {
        copia,
        ...(e.audio!.mime ? { mime: e.audio!.mime } : {}),
        ...(e.audio!.peso ? { peso: e.audio!.peso } : {}),
      })
      audio = { url: r.url, ...(r.mime ? { mime: r.mime } : {}) }
      if (r.nonCopiato) mancanti.audio = r.nonCopiato
      // A copy that worked is kept: a later run does not download it again.
      else if (copia && r.mime) ricorda({ audio: { url: r.url, mime: r.mime } })
    }

    let immagine: string | undefined
    const immagineAllegata = giaQui().immagine
    if (immagineAllegata !== undefined) {
      immagine = immagineAllegata ?? undefined
    } else if (e.immagine) {
      const r = await sistemaFile(e.immagine, 'immagine', { copia })
      immagine = r.url
      if (r.nonCopiato) mancanti.immagine = r.nonCopiato
      else if (copia) ricorda({ immagine: r.url })
    }

    if (mancanti.audio || mancanti.immagine) throw new InAttesaDelFile(mancanti)

    const trascrizioni: FileAllegato[] = []
    for (const t of e.trascrizioni) trascrizioni.push(await sistemaTesto(t, copia, note))
    const capitoli = e.capitoli ? await sistemaTesto(e.capitoli, copia, note) : undefined

    return {
      title: e.titolo,
      // NIP-F4 wants a description: the title stands in for an empty one.
      description: e.descrizione || e.titolo,
      content: e.contenutoHtml ? markdownDaHtml(e.contenutoHtml) : '',
      audio: [audio],
      ...(immagine ? { image: immagine } : {}),
      ...(e.durata ? { duration: e.durata } : {}),
      ...(e.explicit ? { contentWarning: '' } : {}),
      ...(e.guid ? { guidOriginale: e.guid } : {}),
      ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
      ...(e.stagione ? { stagione: e.stagione } : {}),
      ...(e.numero ? { numero: e.numero } : {}),
      ...(e.tipoEpisodio ? { tipoEpisodio: e.tipoEpisodio } : {}),
      trascrizioni,
      ...(capitoli ? { capitoli } : {}),
      persone: e.persone,
      ...(e.valore ? { valore: e.valore } : {}),
    }
  }

  /**
   * Builds, signs and sends one episode, with its own outcome. An episode whose
   * files are not on Blossom is not signed: it waits, with the reason.
   */
  async function pubblicaEpisodio(e: EpisodioImportato): Promise<void> {
    const chiave = chiaveEpisodio(e)
    const stato: AvanzamentoEpisodio = { stato: 'in-corso', note: [] }
    avanzamento.value = { ...avanzamento.value, [chiave]: stato }

    if (giaPresente(e)) {
      avanzamento.value[chiave] = {
        stato: 'gia-presente',
        note: ['Già su questa chiave: saltato.'],
      }
      return
    }
    try {
      const input = await inputEpisodio(e, stato.note)
      fase.value = `Firmo «${e.titolo}»…`
      const template = podcastEpisodeDefinition.build(input, {
        pubkey: identita.pubkey ?? '',
        now: Math.floor(Date.now() / 1000),
      })
      const firmato = await identita.firma(template)
      fase.value = `Pubblico «${e.titolo}»…`
      const riuscita = await invio.pubblica(firmato)
      avanzamento.value[chiave] = {
        stato: riuscita ? 'pubblicato' : 'errore',
        note: riuscita
          ? stato.note
          : [...stato.note, invio.errore.value ?? 'Nessun relay l’ha accettato.'],
        ...(invio.esito.value ? { esito: invio.esito.value } : {}),
      }
      // A second run in this session must skip it without re-reading the relays.
      if (riuscita) propri.anteponi(firmato)
    } catch (err) {
      avanzamento.value[chiave] =
        err instanceof InAttesaDelFile
          ? { stato: 'in-attesa-file', note: stato.note, mancanti: err.mancanti }
          : {
              stato: 'errore',
              note: [...stato.note, err instanceof Error ? err.message : String(err)],
            }
    }
  }

  /**
   * Publishes the chosen batch, oldest first, one episode at a time.
   *
   * One relay refusing an episode does not stop the others, an episode waiting
   * for a file does not either, and a second run skips whatever is already on
   * the key — and tries the waiting ones again.
   */
  async function importaEpisodi(): Promise<void> {
    if (!identita.puoFirmare) {
      errore.value = identita.motivoNonFirmabile ?? 'Serve un’identità che possa firmare.'
      return
    }
    if (modoFile.value === 'copia' && blossom.motivoNonCaricabile.value) {
      errore.value = blossom.motivoNonCaricabile.value
      return
    }
    if (superaLimite.value) {
      errore.value =
        'Il lotto supera il limite di sicurezza: scegli meno episodi, oppure tieni per alcuni l’URL originale.'
      return
    }
    errore.value = null
    inImport.value = true
    try {
      for (const e of importabili.value) {
        if (lotto.value.has(chiaveEpisodio(e))) await pubblicaEpisodio(e)
      }
    } finally {
      inImport.value = false
      fase.value = null
    }
  }

  /** One waiting episode, published again after a change to its files. */
  async function riprova(e: EpisodioImportato): Promise<void> {
    if (!identita.puoFirmare) {
      errore.value = identita.motivoNonFirmabile ?? 'Serve un’identità che possa firmare.'
      return
    }
    errore.value = null
    inImport.value = true
    try {
      await pubblicaEpisodio(e)
    } finally {
      inImport.value = false
      fase.value = null
    }
  }

  /**
   * A file from the disk for a waiting episode — the one downloaded from the
   * old host's panel — put on Blossom, then the episode published if nothing
   * else is missing.
   */
  async function allega(
    e: EpisodioImportato,
    tipo: 'audio' | 'immagine',
    file: File,
  ): Promise<void> {
    const chiave = chiaveEpisodio(e)
    const nota = (testo: string): void => {
      const prima = avanzamento.value[chiave] ?? { stato: 'in-attesa-file' as const, note: [] }
      avanzamento.value = { ...avanzamento.value, [chiave]: { ...prima, note: [testo] } }
    }
    if (blossom.motivoNonCaricabile.value) {
      nota(blossom.motivoNonCaricabile.value)
      return
    }
    inImport.value = true
    try {
      const mime = file.type || (tipo === 'audio' ? 'audio/mpeg' : 'image/jpeg')
      const prima = await blossom.chiedi(file.size, mime)
      if (prima.esito === 'rifiutato') throw new Error(prima.motivo)
      fase.value = `Carico ${file.name}…`
      const { descrittore } = await blossom.carica(file, { mime, nome: file.name })
      allegati.value = {
        ...allegati.value,
        [chiave]: {
          ...allegati.value[chiave],
          ...(tipo === 'audio'
            ? { audio: { url: descrittore.url, mime } }
            : { immagine: descrittore.url }),
        },
      }
    } catch (err) {
      nota(err instanceof Error ? err.message : String(err))
      inImport.value = false
      fase.value = null
      return
    }
    inImport.value = false
    await riprova(e)
  }

  /** A waiting episode without an image of its own: the players show the show's cover. */
  async function senzaImmagine(e: EpisodioImportato): Promise<void> {
    const chiave = chiaveEpisodio(e)
    allegati.value = { ...allegati.value, [chiave]: { ...allegati.value[chiave], immagine: null } }
    await riprova(e)
  }

  /** A waiting episode published with the old host's addresses, by choice. */
  async function conUrlOriginale(e: EpisodioImportato): Promise<void> {
    originaliPerEpisodio.value = new Set([...originaliPerEpisodio.value, chiaveEpisodio(e)])
    await riprova(e)
  }

  return {
    // reading
    urlFonte,
    lettura,
    aperto,
    errore,
    inLettura,
    leggiUrl,
    leggiTesto,
    // choices
    modoFile,
    originaliPerEpisodio,
    destinatariEsclusi,
    lotto,
    giaDistribuito,
    campi,
    limite,
    importabili,
    pesoLotto,
    superaLimite,
    proponiLottoNelLimite,
    valoreScheda,
    // the existing card
    schedaEsistente,
    datiEsistenti,
    rispostaDistribuita,
    linkDelloShow,
    stessoShow,
    linkPiattaforme,
    segniDistribuzione,
    schedaProtetta,
    distribuitaCerta,
    episodiNativi,
    caricamentoPropri: propri.caricamento,
    controllaScheda,
    giaPresente,
    bloccoQuesta,
    // which key
    sceltaChiave,
    dedicata,
    chiavePronta,
    chiaveDedicataCreata,
    copiaCopertina,
    // publishing
    scheda,
    noteScheda,
    inScheda,
    pubblicaScheda,
    avanzamento,
    inImport,
    fase,
    importaEpisodi,
    allegati,
    inAttesaDelFile,
    allega,
    senzaImmagine,
    conUrlOriginale,
  }
}
