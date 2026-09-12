import {
  collegaDelega,
  leggiIndirizzoBanco,
  parsePublicKeyInput,
  toNpub,
  type Delega,
  type EventTemplate,
  type NostrEvent,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Deleghe di firma: identita' altrui per cui questo client puo' chiedere una
 * firma, senza possederne la chiave (NIP-46).
 *
 * L'utente identifica una delega con un npub, ed e' il modo giusto di
 * pensarla, ma va detto cosa serve davvero per crearla: **un npub da solo non
 * basta**. Non dice su quale relay il banco ascolti, ne' autorizza a
 * parlargli. Serve l'indirizzo `bunker://`, che chi possiede la chiave
 * consegna una volta e che contiene relay e segreto. L'npub interviene subito
 * dopo, come **verifica**: ci si collega, si chiede al banco quale identita'
 * firma, e se non e' quella indicata la delega non viene salvata.
 */

const CHIAVE_STORAGE = 'nmc.deleghe'

/** Kind per cui si chiede il permesso al collegamento. Il banco applica poi i suoi. */
const KIND_RICHIESTI = [54, 10154, 20, 21, 1]

export interface DelegaSalvata {
  /** L'identita' che firmera'. */
  pubkey: string
  /** Nome dato dall'utente, per riconoscerla in un menu. */
  etichetta: string
  /**
   * Sessione NIP-46 gia' autorizzata.
   *
   * **Contiene la chiave privata della sessione**, che non e' l'identita' di
   * nessuno: autorizza a *chiedere* al banco, non a firmare. Chi la ottenesse
   * potrebbe presentarsi al banco al posto tuo, e per questo l'interfaccia lo
   * dice invece di lasciarlo intendere.
   */
  sessione: string
  aggiunta: number
}

/** Collegamenti aperti, fuori dallo stato: sono oggetti vivi, non dati. */
const vive = new Map<string, Delega>()

function leggiPersistito(): DelegaSalvata[] {
  if (!import.meta.client) return []
  try {
    const grezzo = localStorage.getItem(CHIAVE_STORAGE)
    return grezzo ? (JSON.parse(grezzo) as DelegaSalvata[]) : []
  } catch {
    return []
  }
}

export const useDeleghe = defineStore('deleghe', () => {
  const elenco = ref<DelegaSalvata[]>([])
  const errore = ref<string | null>(null)
  const inCorso = ref(false)
  /** Chiavi delle deleghe con un collegamento aperto adesso. */
  const collegate = ref<string[]>([])

  function salva(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(elenco.value))
    } catch {
      // Storage non disponibile: la delega vale per questa sessione soltanto.
    }
  }

  function carica(): void {
    elenco.value = leggiPersistito()
  }

  const npubDi = (pubkey: string): string => toNpub(pubkey)

  /**
   * Abbina una delega nuova.
   *
   * @param npubAtteso chi ci si aspetta che firmi. E' il controllo che rende
   *        sicuro l'abbinamento: senza, un indirizzo sbagliato o sostituito
   *        farebbe firmare un'identita' diversa da quella scelta.
   */
  async function aggiungi(npubAtteso: string, uri: string, etichetta: string): Promise<boolean> {
    errore.value = null

    const pool = useRelayPool()
    if (!pool) {
      errore.value = 'Il pool di relay non è disponibile: ricarica la pagina.'
      return false
    }

    let atteso: string
    try {
      atteso = parsePublicKeyInput(npubAtteso)
      leggiIndirizzoBanco(uri)
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    }

    if (elenco.value.some((d) => d.pubkey === atteso)) {
      errore.value = 'Hai già una delega per questa identità: rimuovila prima di rifarla.'
      return false
    }

    inCorso.value = true
    try {
      const delega = await collegaDelega({
        pool,
        uri: uri.trim(),
        autoreAtteso: atteso,
        kinds: KIND_RICHIESTI,
      })

      vive.set(delega.autore, delega)
      collegate.value = [...new Set([...collegate.value, delega.autore])]
      elenco.value = [
        ...elenco.value,
        {
          pubkey: delega.autore,
          etichetta: etichetta.trim() || npubDi(delega.autore).slice(0, 16),
          sessione: delega.sessione(),
          aggiunta: Date.now(),
        },
      ]
      salva()
      return true
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inCorso.value = false
    }
  }

  async function rimuovi(pubkey: string): Promise<void> {
    await vive
      .get(pubkey)
      ?.scollega()
      .catch(() => {})
    vive.delete(pubkey)
    collegate.value = collegate.value.filter((p) => p !== pubkey)
    elenco.value = elenco.value.filter((d) => d.pubkey !== pubkey)
    salva()
  }

  /**
   * Riprende un collegamento, o ne apre uno dalla sessione salvata.
   *
   * I collegamenti non sopravvivono a una ricarica della pagina: si riaprono
   * quando servono, cioe' al momento della firma, invece di tenerne aperti a
   * vuoto per ogni delega registrata.
   */
  async function collegamento(pubkey: string): Promise<Delega> {
    const gia = vive.get(pubkey)
    if (gia) return gia

    const salvata = elenco.value.find((d) => d.pubkey === pubkey)
    if (!salvata) throw new Error('Delega non trovata.')

    const pool = useRelayPool()
    if (!pool) throw new Error('Il pool di relay non è disponibile: ricarica la pagina.')

    const delega = await collegaDelega({
      pool,
      sessione: salvata.sessione,
      autoreAtteso: pubkey,
      kinds: KIND_RICHIESTI,
    })
    vive.set(pubkey, delega)
    collegate.value = [...new Set([...collegate.value, pubkey])]
    return delega
  }

  /**
   * Chiede la firma di un evento a una delega.
   *
   * L'attesa puo' essere lunga: dall'altra parte una persona deve leggere e
   * approvare. Chi chiama deve mostrarlo, non farlo sembrare un blocco.
   */
  async function firma(pubkey: string, template: EventTemplate): Promise<NostrEvent> {
    const delega = await collegamento(pubkey)
    return delega.firma(template)
  }

  return {
    elenco,
    errore,
    inCorso,
    collegate,
    carica,
    aggiungi,
    rimuovi,
    collegamento,
    firma,
    npubDi,
  }
})
