import {
  avviaBanco,
  nuovaChiaveTrasporto,
  nuovoSegretoBanco,
  trasportoDaTesto,
  trasportoInTesto,
  type Banco,
  type EventTemplate,
  type RichiestaFirma,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * The signing desk: this client as a signer for others (NIP-46).
 *
 * Whoever holds the podcast's key keeps this page open; whoever prepares the
 * episodes asks from afar, and every request goes through an approval by hand.
 * The key never leaves this device.
 *
 * **The desk lives as long as the browser tab.** It is not a service: closing
 * the page switches it off, and whoever is asking for a signature at that
 * moment gets an error. It is the price of entrusting the key to nobody, and
 * it is said in the interface instead of being discovered in the field.
 */

const CHIAVE_STORAGE = 'nmc.banco'

/**
 * How long before a request with no answer counts as refused.
 *
 * It is for whoever asks, not whoever approves: without it a requester would
 * wait for ever in front of a desk nobody is watching.
 */
const SCADENZA_RICHIESTA = 3 * 60 * 1000

/** The kinds it makes sense to have somebody else sign, with the risk of each. */
export const kindDelegabili = [
  { kind: 54, etichetta: 'Episodio di podcast', nota: 'NIP-F4. È il caso per cui serve.' },
  {
    kind: 10154,
    etichetta: 'Scheda del podcast',
    nota: 'NIP-F4. Sostituisce la scheda dello show.',
  },
  { kind: 20, etichetta: 'Immagini', nota: 'NIP-68.' },
  { kind: 21, etichetta: 'Video', nota: 'NIP-71.' },
  {
    kind: 1,
    etichetta: 'Nota breve',
    nota: 'Chi ha la delega potrà scrivere note a tuo nome, indistinguibili dalle tue. Concedila solo a chi tratteresti come te stesso.',
  },
] as const

const KIND_PREDEFINITI = [54, 10154]

interface Persistito {
  chiaveTrasporto: string
  segreto: string
  relay: string
  kindsConsentiti: number[]
}

/**
 * The live desk and the pending verdicts, outside the reactive state.
 *
 * The same reason as the private key in the identity's store: in here are
 * functions and connections, which are not serialisable and have no business
 * in the SSR payload.
 */
let bancoVivo: Banco | null = null
const verdetti = new Map<string, (ok: boolean) => void>()

/** A request awaiting judgement, in the form the interface shows. */
export interface RichiestaInAttesa {
  id: string
  cliente: string
  kind: number
  template: EventTemplate
  quando: number
}

export interface VoceStorico {
  kind: number
  approvata: boolean
  quando: number
}

function leggiPersistito(): Persistito | null {
  if (!import.meta.client) return null
  try {
    const grezzo = localStorage.getItem(CHIAVE_STORAGE)
    return grezzo ? (JSON.parse(grezzo) as Persistito) : null
  } catch {
    return null
  }
}

function scriviPersistito(dati: Persistito | null): void {
  if (!import.meta.client) return
  try {
    if (dati) localStorage.setItem(CHIAVE_STORAGE, JSON.stringify(dati))
    else localStorage.removeItem(CHIAVE_STORAGE)
  } catch {
    // Storage unavailable: the desk works all the same, but its address will
    // change next session.
  }
}

export const useBanco = defineStore('banco', () => {
  const identita = useIdentity()

  const attivo = ref(false)
  const inAvvio = ref(false)
  const uri = ref<string | null>(null)
  const trasporto = ref<string | null>(null)
  const cliente = ref<string | null>(null)
  const errore = ref<string | null>(null)

  const relay = ref('')
  const kindsConsentiti = ref<number[]>([...KIND_PREDEFINITI])

  const richieste = ref<RichiestaInAttesa[]>([])
  const storico = ref<VoceStorico[]>([])

  /** The address's material. It stays in memory: every restart of the desk needs it. */
  let chiaveTrasporto = ''
  let segreto = ''

  /** Loads or creates the desk's material. To be called when the page opens. */
  function prepara(relayPredefinito: string): void {
    if (!import.meta.client) return

    const salvato = leggiPersistito()
    if (salvato) {
      chiaveTrasporto = salvato.chiaveTrasporto
      segreto = salvato.segreto
      relay.value = salvato.relay || relayPredefinito
      kindsConsentiti.value = salvato.kindsConsentiti?.length
        ? [...salvato.kindsConsentiti]
        : [...KIND_PREDEFINITI]
      return
    }

    chiaveTrasporto = trasportoInTesto(nuovaChiaveTrasporto())
    segreto = nuovoSegretoBanco()
    relay.value = relayPredefinito
    salva()
  }

  function salva(): void {
    if (!chiaveTrasporto || !segreto) return
    scriviPersistito({
      chiaveTrasporto,
      segreto,
      relay: relay.value,
      kindsConsentiti: [...kindsConsentiti.value],
    })
  }

  /**
   * Changes address, invalidating every delegation granted.
   *
   * It is the only revocation possible: NIP-46 has no way to withdraw the
   * permission from a single requester, so the desk is moved and the new
   * address handed again to whoever is still to be authorized.
   */
  async function rigeneraIndirizzo(): Promise<void> {
    await ferma()
    chiaveTrasporto = trasportoInTesto(nuovaChiaveTrasporto())
    segreto = nuovoSegretoBanco()
    salva()
  }

  async function avvia(): Promise<boolean> {
    errore.value = null

    if (!identita.puoFirmare) {
      errore.value = identita.motivoNonFirmabile ?? 'Serve una chiave che possa firmare.'
      return false
    }
    if (!relay.value.trim()) {
      errore.value = 'Indica il relay su cui il banco resta in ascolto.'
      return false
    }
    if (kindsConsentiti.value.length === 0) {
      errore.value = 'Scegli almeno un kind: un banco che non firma nulla non serve a niente.'
      return false
    }

    const pool = useRelayPool()
    if (!pool) {
      errore.value = 'Il pool di relay non è disponibile: ricarica la pagina.'
      return false
    }

    await ferma()
    inAvvio.value = true
    try {
      bancoVivo = await avviaBanco({
        pool,
        relays: [relay.value.trim()],
        identita: {
          pubkey: () => Promise.resolve(identita.pubkey ?? ''),
          firma: (template) => identita.firma(template),
        },
        chiaveTrasporto: trasportoDaTesto(chiaveTrasporto),
        segreto,
        kindsConsentiti: [...kindsConsentiti.value],
        approva: (richiesta) => accoda(richiesta),
        onCollegato: (chi) => {
          cliente.value = chi
        },
      })

      uri.value = bancoVivo.uri
      trasporto.value = bancoVivo.trasporto
      attivo.value = true
      salva()
      return true
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      inAvvio.value = false
    }
  }

  async function ferma(): Promise<void> {
    // The pending requests are not left hanging: whoever is waiting gets a
    // refusal, which is an outcome, instead of silence.
    for (const r of richieste.value) verdetti.get(r.id)?.(false)
    verdetti.clear()
    richieste.value = []

    if (bancoVivo) await bancoVivo.ferma().catch(() => {})
    bancoVivo = null
    attivo.value = false
    uri.value = null
    cliente.value = null
  }

  /** Puts a request in the queue and waits for the human verdict. */
  function accoda(richiesta: RichiestaFirma): Promise<boolean> {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

    return new Promise<boolean>((risolvi) => {
      const chiudi = (ok: boolean): void => {
        if (!verdetti.has(id)) return
        verdetti.delete(id)
        richieste.value = richieste.value.filter((r) => r.id !== id)
        storico.value = [
          { kind: richiesta.kind, approvata: ok, quando: Date.now() },
          ...storico.value,
        ].slice(0, 20)
        risolvi(ok)
      }

      verdetti.set(id, chiudi)
      richieste.value = [
        ...richieste.value,
        {
          id,
          cliente: richiesta.cliente,
          kind: richiesta.kind,
          template: richiesta.template,
          quando: Date.now(),
        },
      ]

      setTimeout(() => chiudi(false), SCADENZA_RICHIESTA)
    })
  }

  /** Approves or refuses a queued request. */
  function decidi(id: string, approvata: boolean): void {
    verdetti.get(id)?.(approvata)
  }

  function consentiKind(kind: number, si: boolean): void {
    kindsConsentiti.value = si
      ? [...new Set([...kindsConsentiti.value, kind])]
      : kindsConsentiti.value.filter((k) => k !== kind)
    salva()
  }

  return {
    attivo,
    inAvvio,
    uri,
    trasporto,
    cliente,
    errore,
    relay,
    kindsConsentiti,
    richieste,
    storico,
    prepara,
    avvia,
    ferma,
    decidi,
    consentiKind,
    rigeneraIndirizzo,
    salva,
  }
})
