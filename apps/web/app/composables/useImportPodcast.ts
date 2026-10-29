import {
  BlossomError,
  PIATTAFORME,
  TIPO_AUDIO,
  TIPO_TESTO,
  leggiFeedEsterno,
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
import { useConfigurazione } from '~/stores/configurazione'
import { useMediaManager } from '~/stores/mediamanager'

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
 * is published, and a file Blossom refuses keeps its original address with the
 * reason beside it.
 */

export type ModoFile = 'copia' | 'originale'

export type StatoEpisodioImport =
  'in-attesa' | 'gia-presente' | 'in-corso' | 'pubblicato' | 'saltato' | 'errore'

export interface AvanzamentoEpisodio {
  stato: StatoEpisodioImport
  /** What happened, in words: a file kept at its original address and why, an error. */
  note: string[]
  esito?: RisultatoPubblicazione
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
  const configurazione = useConfigurazione()
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

  const limite = computed(() => configurazione.limiteImportByte)

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
  /** The user's answer to «is this card already on a platform?». */
  const rispostaDistribuita = ref<'si' | 'no' | null>(null)

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

  /** The signs that the existing card is a podcast already out there. */
  const segniDistribuzione = computed<string[]>(() => {
    const d = datiEsistenti.value
    if (!d) return []
    const segni: string[] = []
    if (d.feedUrl) segni.push(`ha già un indirizzo del feed (${d.feedUrl})`)
    for (const p of PIATTAFORME) {
      if (urlShowSu(p, d.websites)) segni.push(`ha un link a ${p.nome}`)
    }
    return segni
  })

  /**
   * Whether the existing card must be protected from being replaced.
   *
   * In doubt it is: replacing a podcast that is out there would turn it into
   * another one for every app that follows it, and there is no undoing that.
   */
  const schedaProtetta = computed(
    () =>
      !!schedaEsistente.value &&
      (segniDistribuzione.value.length > 0 || rispostaDistribuita.value !== 'no'),
  )

  /** Why the active key cannot take this podcast, for the key's question. */
  const bloccoQuesta = computed<string | null>(() => {
    if (!schedaProtetta.value) return null
    const titolo = datiEsistenti.value?.title ?? 'senza titolo'
    if (segniDistribuzione.value.length > 0) {
      return `Ha già la scheda «${titolo}», distribuita: un secondo podcast non ci sta.`
    }
    if (rispostaDistribuita.value === 'si') {
      return `Ha già la scheda «${titolo}», pubblicata su qualche piattaforma: un secondo podcast non ci sta.`
    }
    return `Ha già la scheda «${titolo}»: rispondi prima alla domanda qui sopra.`
  })

  // ── 3b. which key ──────────────────────────────────────────────────────

  /** The answer to «which key does the podcast live on». */
  const sceltaChiave = ref<SceltaChiave | null>(null)
  /** When a dedicated key was created: the key, and the personal one to name as host. */
  const dedicata = ref<{ pubkey: string; autore: string } | null>(null)

  const chiavePronta = computed(
    () =>
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
        campi.immagine = (
          await sistemaFile(campi.immagine, 'immagine', { copia: true }, noteScheda.value)
        ).url
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
    if (segniDistribuzione.value.length > 0) {
      scheda.errore.value =
        'La scheda già presente risulta distribuita: due podcast non stanno su una chiave. Importa su una chiave dedicata.'
      return false
    }
    if (schedaProtetta.value) {
      scheda.errore.value =
        'Questa chiave ha già una scheda podcast: conferma che non è pubblicata su nessuna piattaforma, oppure importa su una chiave dedicata. Sostituire un podcast distribuito lo trasformerebbe in un altro.'
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

  /**
   * One file onto Blossom, or its original URL with the reason.
   *
   * A refusal does not stop the episode: the file stays where it was, which
   * still plays, and the note says why — a full server, a paid one, a host
   * that will not let the browser read it.
   */
  async function sistemaFile(
    url: string,
    tipo: 'audio' | 'immagine' | 'testo',
    opzioni: { mime?: string; peso?: number; copia: boolean },
    note: string[],
  ): Promise<{ url: string; mime?: string }> {
    const originale = { url, ...(opzioni.mime ? { mime: opzioni.mime } : {}) }
    if (!opzioni.copia) return originale

    if (opzioni.peso) {
      const prima = await blossom.chiedi(opzioni.peso, opzioni.mime ?? 'application/octet-stream')
      if (prima.esito === 'rifiutato') {
        note.push(`${nomeDaUrl(url, tipo)} resta all’indirizzo originale: ${prima.motivo}`)
        return originale
      }
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
      note.push(`${nomeDaUrl(url, tipo)} resta all’indirizzo originale: ${motivo}`)
      return originale
    }
  }

  async function inputEpisodio(e: EpisodioImportato, note: string[]): Promise<PodcastEpisodeInput> {
    const copia = copiaPer(e)
    const audio = await sistemaFile(
      e.audio!.url,
      'audio',
      {
        copia,
        ...(e.audio!.mime ? { mime: e.audio!.mime } : {}),
        ...(e.audio!.peso ? { peso: e.audio!.peso } : {}),
      },
      note,
    )
    const immagine = e.immagine
      ? (await sistemaFile(e.immagine, 'immagine', { copia }, note)).url
      : undefined
    const trascrizioni: FileAllegato[] = []
    for (const t of e.trascrizioni) {
      trascrizioni.push(
        await sistemaFile(t.url, 'testo', { copia, ...(t.mime ? { mime: t.mime } : {}) }, note),
      )
    }
    const capitoli = e.capitoli
      ? await sistemaFile(
          e.capitoli.url,
          'testo',
          { copia, ...(e.capitoli.mime ? { mime: e.capitoli.mime } : {}) },
          note,
        )
      : undefined

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
   * Publishes the chosen batch, oldest first, one episode at a time.
   *
   * Each one is built, signed and sent on its own, with its own outcome: one
   * relay refusing an episode does not stop the others, and a second run skips
   * whatever is already on the key.
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
        'Il lotto supera il limite di sicurezza: scegli meno episodi, tieni per alcuni l’URL originale, oppure alza il limite in Impostazioni.'
      return
    }
    errore.value = null
    inImport.value = true
    try {
      for (const e of importabili.value) {
        const chiave = chiaveEpisodio(e)
        if (!lotto.value.has(chiave)) continue
        const stato: AvanzamentoEpisodio = { stato: 'in-corso', note: [] }
        avanzamento.value = { ...avanzamento.value, [chiave]: stato }

        if (giaPresente(e)) {
          avanzamento.value[chiave] = {
            stato: 'gia-presente',
            note: ['Già su questa chiave: saltato.'],
          }
          continue
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
          avanzamento.value[chiave] = {
            stato: 'errore',
            note: [...stato.note, err instanceof Error ? err.message : String(err)],
          }
        }
      }
    } finally {
      inImport.value = false
      fase.value = null
    }
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
    segniDistribuzione,
    schedaProtetta,
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
  }
}
