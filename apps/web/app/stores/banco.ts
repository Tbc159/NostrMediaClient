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
 * Banco di firma: questo client come firmatario per altri (NIP-46).
 *
 * Chi possiede la chiave del podcast tiene aperta questa pagina; chi prepara
 * gli episodi chiede da lontano, e ogni richiesta passa da un'approvazione a
 * mano. La chiave non lascia mai questo dispositivo.
 *
 * **Il banco vive quanto la scheda del browser.** Non e' un servizio: chiudere
 * la pagina lo spegne, e chi sta chiedendo una firma in quel momento riceve un
 * errore. E' il prezzo del non affidare la chiave a nessuno, ed e' detto in
 * interfaccia invece di essere scoperto sul campo.
 */

const CHIAVE_STORAGE = 'nmc.banco'

/**
 * Dopo quanto una richiesta senza risposta si intende rifiutata.
 *
 * Serve a chi chiede, non a chi approva: senza, un richiedente resterebbe in
 * attesa per sempre davanti a un banco che nessuno guarda.
 */
const SCADENZA_RICHIESTA = 3 * 60 * 1000

/** I kind che ha senso far firmare a qualcun altro, con il rischio di ciascuno. */
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
 * Il banco vivo e i verdetti in sospeso, fuori dallo stato reattivo.
 *
 * Stessa ragione della chiave privata nello store dell'identita': qui dentro
 * ci sono funzioni e connessioni, che non sono serializzabili e non hanno
 * nulla da fare nel payload SSR.
 */
let bancoVivo: Banco | null = null
const verdetti = new Map<string, (ok: boolean) => void>()

/** Una richiesta in attesa di giudizio, nella forma che l'interfaccia mostra. */
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
    // Storage non disponibile: il banco funziona lo stesso, ma il suo
    // indirizzo cambiera' alla prossima sessione.
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

  /** Materiale dell'indirizzo. Resta in memoria: serve a ogni riavvio del banco. */
  let chiaveTrasporto = ''
  let segreto = ''

  /** Carica o crea il materiale del banco. Da chiamare all'apertura della pagina. */
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
   * Cambia indirizzo, invalidando ogni delega concessa.
   *
   * E' la sola revoca possibile: NIP-46 non prevede di ritirare il permesso a
   * un singolo richiedente, quindi si sposta il banco e si riconsegna il nuovo
   * indirizzo a chi si vuole ancora autorizzare.
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
    // Le richieste in sospeso non restano appese: chi sta aspettando riceve un
    // rifiuto, che e' un esito, invece di un silenzio.
    for (const r of richieste.value) verdetti.get(r.id)?.(false)
    verdetti.clear()
    richieste.value = []

    if (bancoVivo) await bancoVivo.ferma().catch(() => {})
    bancoVivo = null
    attivo.value = false
    uri.value = null
    cliente.value = null
  }

  /** Mette una richiesta in coda e resta in attesa del verdetto umano. */
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

  /** Approva o rifiuta una richiesta in coda. */
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
