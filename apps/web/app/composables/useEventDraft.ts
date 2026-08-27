import type { AnyKindDefinition, EventTemplate, NostrEvent } from '@nmc/nostr-core'

/**
 * Ciclo di vita di un evento in composizione: costruzione, firma, invio.
 *
 * I tre passaggi restano distinti perche' falliscono per ragioni diverse e si
 * rimediano in modi diversi: un errore di costruzione si corregge nel form, uno
 * di firma sbloccando la chiave, uno di invio cambiando relay. Fonderli in un
 * unico pulsante "pubblica" nasconderebbe all'utente quale dei tre e' andato
 * storto.
 */
export function useEventDraft() {
  const identita = useIdentity()
  const invio = usePublish()

  const template = ref<EventTemplate | null>(null)
  const firmato = ref<NostrEvent | null>(null)
  const errore = ref<string | null>(null)
  const inCorso = ref(false)

  function azzera(): void {
    template.value = null
    firmato.value = null
    errore.value = null
    invio.azzera()
  }

  /**
   * Costruisce il template passando dalla definizione del kind.
   *
   * Gli errori di validazione arrivano da qui e sono quelli veri del dominio,
   * non controlli duplicati nel form: se il kind rifiuta un input, lo rifiuta
   * allo stesso modo ovunque venga usato.
   */
  function costruisci(definizione: AnyKindDefinition, input: unknown): boolean {
    errore.value = null
    firmato.value = null
    try {
      template.value = definizione.build(input, {
        pubkey: identita.pubkey ?? '00'.repeat(32),
        now: Math.floor(Date.now() / 1000),
      })
      return true
    } catch (e) {
      template.value = null
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** Firma il template con la modalita' di accesso attiva. */
  async function firma(): Promise<boolean> {
    if (!template.value) {
      errore.value = 'Nessun evento da firmare.'
      return false
    }
    errore.value = null
    inCorso.value = true
    try {
      firmato.value = await identita.firma(template.value)
      return true
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inCorso.value = false
    }
  }

  /**
   * Firma e invia in un colpo solo, per il pulsante principale dei form.
   *
   * Se l'evento e' gia' firmato non lo rifirma: rifirmare cambierebbe la firma
   * a parita' di contenuto e, con NIP-07, farebbe ricomparire il popup
   * dell'estensione a ogni tentativo di reinvio.
   */
  async function firmaEPubblica(): Promise<boolean> {
    if (!firmato.value && !(await firma())) return false
    if (!firmato.value) return false
    return invio.pubblica(firmato.value)
  }

  return {
    template,
    firmato,
    errore,
    inCorso,
    costruisci,
    firma,
    azzera,
    firmaEPubblica,
    // Stato dell'invio, esposto cosi' com'e': le pagine mostrano l'esito per
    // relay, non un riassunto.
    invio,
  }
}
