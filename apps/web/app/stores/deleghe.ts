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
 * Signing delegations: other people's identities this client can ask for a
 * signature for, without holding their key (NIP-46).
 *
 * The user identifies a delegation by an npub, and that is the right way to
 * think of it, but what it really takes to create one is worth saying: **an
 * npub alone is not enough**. It says neither which relay the desk listens on
 * nor authorizes talking to it. What is needed is the `bunker://` address,
 * which whoever holds the key hands over once and which contains the relays
 * and the secret. The npub steps in straight afterwards, as a **check**: you
 * connect, you ask the desk which identity signs, and if it is not the one
 * stated the delegation is not saved.
 */

const CHIAVE_STORAGE = 'nmc.deleghe'

/** The kinds permission is asked for when connecting. The desk then applies its own. */
const KIND_RICHIESTI = [54, 10154, 20, 21, 1]

export interface DelegaSalvata {
  /** The identity that will sign. */
  pubkey: string
  /** A name the user gave it, to recognise it in a menu. */
  etichetta: string
  /**
   * An already authorized NIP-46 session.
   *
   * **It contains the session's private key**, which is nobody's identity: it
   * authorizes *asking* the desk, not signing. Whoever obtained it could
   * present themselves at the desk in your place, and that is why the
   * interface says so instead of leaving it to be inferred.
   */
  sessione: string
  aggiunta: number
}

/** The open connections, outside the state: they are live objects, not data. */
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
  /** The keys of the delegations with a connection open right now. */
  const collegate = ref<string[]>([])

  function salva(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(elenco.value))
    } catch {
      // Storage unavailable: the delegation holds for this session alone.
    }
  }

  function carica(): void {
    elenco.value = leggiPersistito()
  }

  const npubDi = (pubkey: string): string => toNpub(pubkey)

  /**
   * Pairs a new delegation.
   *
   * @param npubAtteso who is expected to sign. It is the check that makes the
   *        pairing safe: without it a wrong or substituted address would have
   *        an identity other than the chosen one sign.
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
   * Picks a connection up again, or opens one from the saved session.
   *
   * The connections do not survive a page reload: they are reopened when they
   * are needed, that is at signing time, instead of keeping one open to no
   * purpose for every registered delegation.
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
   * Asks a delegation to sign an event.
   *
   * The wait can be long: on the other side a person has to read and approve.
   * The caller has to show that, not make it look like a freeze.
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
