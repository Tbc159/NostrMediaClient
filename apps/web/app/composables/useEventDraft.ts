import type { AnyKindDefinition, EventTemplate, NostrEvent } from '@nmc/nostr-core'

/**
 * Ciclo di vita di un evento in composizione: costruzione, firma, esito.
 *
 * Il flusso si ferma all'evento firmato: la pubblicazione sui relay arriva con
 * il pool, in Fase 1. Fermarsi qui non e' una finzione — il template e la
 * firma sono gia' quelli veri, e quando il pool ci sara' bastera' aggiungere
 * l'invio senza toccare i form.
 */
export function useEventDraft() {
  const identita = useIdentity()

  const template = ref<EventTemplate | null>(null)
  const firmato = ref<NostrEvent | null>(null)
  const errore = ref<string | null>(null)
  const inCorso = ref(false)

  function azzera(): void {
    template.value = null
    firmato.value = null
    errore.value = null
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

  return { template, firmato, errore, inCorso, costruisci, firma, azzera }
}
