import {
  cancellaBozza,
  draftIdentifier,
  draftWrapDefinition,
  loadTimeline,
  privateRelaysDefinition,
  unwrapDraft,
  unwrapPrivateRelays,
  wrapDraft,
  type DraftWrapParsed,
  type EventTemplate,
  type NostrEvent,
} from '@nmc/nostr-core'

/**
 * Bozze cifrate sui relay (NIP-37).
 *
 * Differenza con `useBozzeLocali`, che resta: queste seguono su un altro
 * dispositivo, quelle no. In cambio queste richiedono una chiave capace di
 * cifrare — la sola lettura non basta — e finiscono comunque su un relay,
 * seppure illeggibili.
 */

export interface BozzaRemota {
  /** Identificatore pubblico dell'involucro: un hash, non dice nulla. */
  involucro: string
  /**
   * Identificatore vero dell'evento in bozza, che sta **dentro** il contenuto
   * cifrato. Assente se la bozza non si e' potuta decifrare.
   */
  identificatore: string | null
  /** Titolo leggibile, ricavato decifrando: serve a mostrare qualcosa di utile. */
  titolo: string
  /** Kind dell'evento contenuto, dal tag `k`: si sa senza decifrare. */
  kindBozza: number
  aggiornataAl: number
  scadenza: number | null
  /** Contenuto decifrato, gia' pronto per il form. */
  template: EventTemplate | null
  grezza: DraftWrapParsed
  evento: NostrEvent
}

export function useBozzeRemote() {
  const pool = useRelayPool()
  const identita = useIdentity()
  const config = useClientConfig()

  const bozze = ref<BozzaRemota[]>([])
  const caricamento = ref(false)
  const errore = ref<string | null>(null)
  const invio = usePublish()

  const disponibili = computed(() => identita.cifrario !== null)

  /**
   * Relay su cui tenere le bozze.
   *
   * L'ordine e' quello della specifica: prima l'elenco privato del kind 10013,
   * poi il relay per bozze configurato. **Non** si ripiega mai sui relay di
   * scrittura pubblici: una bozza e' cifrata, ma metterla dove finisce tutto
   * il resto ne rivela comunque l'esistenza e la cadenza.
   */
  const relayPrivati = ref<string[]>([])
  const destinazioni = computed(() => {
    if (relayPrivati.value.length > 0) return relayPrivati.value
    const bozzeRelay = config.value.draftRelay
    return bozzeRelay ? [bozzeRelay] : []
  })

  const senzaDestinazione = computed(() => destinazioni.value.length === 0)

  /** Legge il kind 10013, se c'e'. */
  async function caricaRelayPrivati(): Promise<void> {
    if (!pool || !identita.pubkey || !identita.cifrario) return
    const sorgenti = [...config.value.readRelays, ...config.value.writeRelays]
    const eventi = await loadTimeline(
      pool,
      sorgenti,
      { kinds: [10013], authors: [identita.pubkey], limit: 1 },
      { timeoutMs: 6000 },
    )
    const primo = eventi[0]
    if (!primo) return
    try {
      const { ciphertext } = privateRelaysDefinition.parse(primo)
      relayPrivati.value = await unwrapPrivateRelays(identita.cifrario, ciphertext)
    } catch {
      // Elenco illeggibile: si resta sulla configurazione locale.
      relayPrivati.value = []
    }
  }

  async function carica(): Promise<void> {
    if (!pool || !identita.pubkey || !identita.cifrario) {
      bozze.value = []
      return
    }
    caricamento.value = true
    errore.value = null
    try {
      await caricaRelayPrivati()
      if (senzaDestinazione.value) {
        bozze.value = []
        return
      }

      const eventi = await loadTimeline(
        pool,
        destinazioni.value,
        { kinds: [31234], authors: [identita.pubkey], limit: 100 },
        { timeoutMs: 8000 },
      )

      const lette: BozzaRemota[] = []
      for (const e of eventi) {
        try {
          const grezza = draftWrapDefinition.parse(e)
          // Una bozza cancellata resta sul relay come involucro vuoto: non va
          // mostrata, ma nemmeno trattata come un errore.
          if (grezza.cancellata) continue

          // Si decifra subito: l'identificatore pubblico e' un hash e non dice
          // nulla, quindi senza aprire il contenuto l'elenco mostrerebbe una
          // fila di stringhe esadecimali.
          let template: EventTemplate | null = null
          try {
            template = await unwrapDraft(identita.cifrario, grezza)
          } catch {
            // Bozza scritta con un'altra identita': si elenca comunque, con
            // quel poco che i tag pubblici dicono.
          }

          const tag = (nome: string): string | undefined =>
            template?.tags.find((t) => t[0] === nome)?.[1]

          lette.push({
            involucro: grezza.identifier,
            identificatore: tag('d') ?? null,
            titolo: tag('title') ?? (template ? 'senza titolo' : 'non decifrabile'),
            kindBozza: grezza.draftKind,
            aggiornataAl: e.created_at,
            scadenza: grezza.expiration ?? null,
            template,
            grezza,
            evento: e,
          })
        } catch {
          // Un involucro malformato non deve nascondere le altre bozze.
        }
      }
      bozze.value = lette
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
    } finally {
      caricamento.value = false
    }
  }

  /** Evento non firmato contenuto nella bozza, gia' decifrato al caricamento. */
  function apri(bozza: BozzaRemota): EventTemplate | null {
    if (!bozza.template) {
      errore.value =
        identita.motivoNonCifrabile ??
        'Questa bozza non si decifra con l’identita’ attiva: probabilmente e’ stata scritta con un’altra chiave.'
      return null
    }
    return bozza.template
  }

  /**
   * Cifra, firma e pubblica una bozza.
   *
   * L'evento contenuto **non** viene firmato: e' un lavoro in corso, e firmarlo
   * produrrebbe un id definitivo per un contenuto che cambiera' ancora. La
   * firma la porta l'involucro.
   */
  async function salva(
    identificatore: string,
    template: EventTemplate,
    opzioni: { conScadenza?: boolean } = {},
  ): Promise<boolean> {
    if (!identita.cifrario) {
      errore.value = identita.motivoNonCifrabile
      return false
    }
    if (senzaDestinazione.value) {
      errore.value =
        'Nessun relay per le bozze configurato. Le bozze cifrate hanno bisogno di un relay privato: impostane uno dalle impostazioni.'
      return false
    }

    errore.value = null
    try {
      // L'identificatore pubblico e' un hash di quello vero: deterministico,
      // cosi' risalvare sostituisce, e opaco, cosi' il relay non impara il
      // titolo dal tag `d`, che non e' cifrato.
      const involucro_ = await draftIdentifier(identificatore)
      const input = await wrapDraft(identita.cifrario, involucro_, template, {
        ...(opzioni.conScadenza === false ? { expiration: null } : {}),
      })
      const involucro = draftWrapDefinition.build(input, {
        pubkey: identita.pubkey ?? '',
        now: Math.floor(Date.now() / 1000),
      })
      const firmato = await identita.firma(involucro)
      const ok = await invio.pubblica(firmato, destinazioni.value)
      if (ok) await carica()
      return ok
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** Cancella una bozza svuotandone il contenuto, come vuole la specifica. */
  async function elimina(bozza: BozzaRemota): Promise<boolean> {
    errore.value = null
    try {
      const involucro = draftWrapDefinition.build(cancellaBozza(bozza.grezza), {
        pubkey: identita.pubkey ?? '',
        now: Math.floor(Date.now() / 1000),
      })
      const firmato = await identita.firma(involucro)
      const ok = await invio.pubblica(firmato, destinazioni.value)
      if (ok) await carica()
      return ok
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /**
   * Si risolve dopo il primo caricamento.
   *
   * Serve a chi apre una bozza da un link: il caricamento parte in un
   * `onMounted` e chi cerca la bozza gira in un altro, senza garanzia
   * sull'ordine. Senza questa attesa la bozza risulterebbe inesistente proprio
   * mentre sta arrivando.
   */
  let risolviPronte: () => void = () => {}
  const pronte = new Promise<void>((r) => {
    risolviPronte = r
  })

  onMounted(async () => {
    await carica()
    risolviPronte()
  })
  watch(() => identita.pubkey, carica)
  watch(() => identita.cifrario !== null, carica)

  return {
    pronte,
    bozze,
    caricamento,
    errore,
    invio,
    disponibili,
    destinazioni,
    senzaDestinazione,
    carica,
    apri,
    salva,
    elimina,
  }
}
