import {
  fondiTag,
  type AnyKindDefinition,
  type EventTemplate,
  type Firmatario,
  type NostrEvent,
  type Tag,
} from '@nmc/nostr-core'

/**
 * The lifecycle of an event being composed: building, signing, sending.
 *
 * The three steps stay separate because they fail for different reasons and
 * are remedied in different ways: a building error is corrected in the form, a
 * signing one by unlocking the key, a sending one by changing relay. Merging
 * them into a single "publish" button would hide from the user which of the
 * three went wrong.
 */
export function useEventDraft() {
  const identita = useIdentity()
  const invio = usePublish()

  const template = ref<EventTemplate | null>(null)
  const firmato = ref<NostrEvent | null>(null)
  const errore = ref<string | null>(null)
  const inCorso = ref(false)

  /**
   * True when the event in hand has been accepted by at least one relay.
   *
   * It is the moment the «Publish» button has to disappear: bringing it back
   * after a positive outcome suggests something is missing. Whoever wants to
   * push the event to the relays that did not take it does so from the
   * outcome, relay by relay; whoever wants to change it rebuilds, and
   * rebuilding clears the outcome.
   */
  const pubblicato = computed(() => invio.esito.value?.riuscita === true)

  function azzera(): void {
    template.value = null
    firmato.value = null
    errore.value = null
    invio.azzera()
  }

  /**
   * Builds the template by going through the kind's definition.
   *
   * The validation errors come from there and are the real domain ones, not
   * checks duplicated in the form: if the kind refuses an input, it refuses it
   * the same way wherever it is used.
   *
   * `aggiuntivi` are the tags this client does not govern: they are derived
   * when an already published event is opened, with `tagAggiuntivi()`, or
   * added by the user from the form's «Tag» section.
   */
  function costruisci(
    definizione: AnyKindDefinition,
    input: unknown,
    opzioni: { aggiuntivi?: readonly Tag[] } = {},
  ): boolean {
    errore.value = null
    firmato.value = null
    // A new template is a new publication: the earlier outcome does not apply.
    invio.azzera()
    try {
      const costruito = definizione.build(input, {
        pubkey: identita.pubkey ?? '00'.repeat(32),
        now: Math.floor(Date.now() / 1000),
      })
      // The tags the kind does not write — the ones read from the original
      // event and the ones added by hand — are appended. Without that, editing
      // somebody else's event would mean deleting everything our form cannot
      // represent.
      template.value = opzioni.aggiuntivi?.length
        ? { ...costruito, tags: fondiTag(costruito.tags, opzioni.aggiuntivi) }
        : costruito
      return true
    } catch (e) {
      template.value = null
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /**
   * Signs the template.
   *
   * Without arguments it signs with the active identity. Passing a
   * `firmatario` — a NIP-46 delegation — the event comes out with **that
   * other** identity's `pubkey`: it is not a variant of the same action, it is
   * publishing in someone else's name. That is why the signer is passed on
   * every call instead of being state of the composable: nobody must be able
   * to forget it switched on.
   */
  async function firma(firmatario?: Firmatario): Promise<boolean> {
    if (!template.value) {
      errore.value = 'Nessun evento da firmare.'
      return false
    }
    errore.value = null
    inCorso.value = true
    try {
      firmato.value = firmatario
        ? await firmatario.firma(template.value)
        : await identita.firma(template.value)
      return true
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inCorso.value = false
    }
  }

  /**
   * Signs and sends in one go, for the forms' main button.
   *
   * When the event is signed already it does not re-sign it: re-signing would
   * change the signature for identical content and, with NIP-07, would bring
   * the extension's popup back on every attempt to resend.
   */
  async function firmaEPubblica(firmatario?: Firmatario): Promise<boolean> {
    if (!firmato.value && !(await firma(firmatario))) return false
    if (!firmato.value) return false
    return invio.pubblica(firmato.value)
  }

  return {
    template,
    firmato,
    errore,
    inCorso,
    pubblicato,
    costruisci,
    firma,
    azzera,
    firmaEPubblica,
    // The state of the sending, exposed as it is: the pages show the outcome
    // per relay, not a summary.
    invio,
  }
}
