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
 * Encrypted drafts on the relays (NIP-37).
 *
 * The difference from `useBozzeLocali`, which stays: these follow you to
 * another device, those do not. In exchange these require a key able to
 * encrypt — read-only is not enough — and end up on a relay all the same,
 * unreadable though they are.
 */

export interface BozzaRemota {
  /** The wrapper's public identifier: a hash, it says nothing. */
  involucro: string
  /**
   * The real identifier of the drafted event, which sits **inside** the
   * encrypted content. Absent when the draft could not be decrypted.
   */
  identificatore: string | null
  /** A readable title, obtained by decrypting: it is there to show something useful. */
  titolo: string
  /** The contained event's kind, from the `k` tag: known without decrypting. */
  kindBozza: number
  aggiornataAl: number
  scadenza: number | null
  /** The decrypted content, ready for the form. */
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
   * The relays to keep the drafts on.
   *
   * The order is the specification's: the kind 10013 private list first, then
   * the configured draft relay. It **never** falls back on the public write
   * relays: a draft is encrypted, but putting it where everything else ends up
   * still reveals its existence and its rhythm.
   */
  const relayPrivati = ref<string[]>([])
  const destinazioni = computed(() => {
    if (relayPrivati.value.length > 0) return relayPrivati.value
    const bozzeRelay = config.value.draftRelay
    return bozzeRelay ? [bozzeRelay] : []
  })

  const senzaDestinazione = computed(() => destinazioni.value.length === 0)

  /** Reads the kind 10013, when there is one. */
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
      // An unreadable list: we stay on the local configuration.
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
          // A deleted draft stays on the relay as an empty wrapper: it is not
          // to be shown, but not to be treated as an error either.
          if (grezza.cancellata) continue

          // It is decrypted straight away: the public identifier is a hash and
          // says nothing, so without opening the content the list would show a
          // row of hexadecimal strings.
          let template: EventTemplate | null = null
          try {
            template = await unwrapDraft(identita.cifrario, grezza)
          } catch {
            // A draft written with another identity: it is listed all the
            // same, with what little the public tags say.
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
          // A malformed wrapper must not hide the other drafts.
        }
      }
      bozze.value = lette
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
    } finally {
      caricamento.value = false
    }
  }

  /** The unsigned event the draft contains, decrypted when it was loaded. */
  function apri(bozza: BozzaRemota): EventTemplate | null {
    if (!bozza.template) {
      errore.value =
        identita.motivoNonCifrabile ??
        'Questa bozza non si decifra con l’identità attiva: probabilmente è stata scritta con un’altra chiave.'
      return null
    }
    return bozza.template
  }

  /**
   * Encrypts, signs and publishes a draft.
   *
   * The contained event is **not** signed: it is work in progress, and signing
   * it would produce a definitive id for content that will change again. The
   * wrapper is what carries the signature.
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
      // The public identifier is a hash of the real one: deterministic, so
      // saving again replaces, and opaque, so the relay does not learn the
      // title from the `d` tag, which is not encrypted.
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

  /** Deletes a draft by emptying its content, as the specification wants. */
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
   * Resolves after the first load.
   *
   * Whoever opens a draft from a link needs it: the loading starts in one
   * `onMounted` and whoever looks for the draft runs in another, with no
   * guarantee about the order. Without this wait the draft would come out
   * non-existent exactly while it is arriving.
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
