import {
  clientEsterniPredefiniti,
  resolveClientConfig,
  risolviClient,
  validaTemplate,
  type ClientConfig,
  type ClientEsterno,
  type PiattaformaClient,
  type RawEnv,
  type StrategiaPubblicazione,
} from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Endpoint effettivi del client: default d'ambiente piu' le scelte dell'utente.
 *
 * I valori del `.env` restano quello che il piano dice che sono — **default di
 * primo avvio, mai dipendenze**. Qui sopra si sovrappone cio' che l'utente
 * decide dalle impostazioni, che vive nel suo browser e non nel repository.
 *
 * La sovrapposizione avviene sulla forma *grezza* (le stringhe separate da
 * virgola dell'ambiente) e non sull'oggetto gia' validato: cosi' la
 * validazione resta quella sola di `resolveClientConfig`, condivisa fra app,
 * SSR e script da riga di comando, invece di essere riscritta qui in una
 * variante che col tempo divergerebbe.
 */

const CHIAVE_STORAGE = 'nmc.endpoint'

/** Campi sovrascrivibili dall'utente, nella forma dell'ambiente. */
export type OverrideEndpoint = Pick<
  RawEnv,
  | 'NUXT_PUBLIC_DEFAULT_READ_RELAYS'
  | 'NUXT_PUBLIC_DEFAULT_WRITE_RELAYS'
  | 'NUXT_PUBLIC_INDEXER_RELAYS'
  | 'NUXT_PUBLIC_DRAFT_RELAY'
  | 'NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS'
>

interface Persistito {
  override: OverrideEndpoint
  strategia?: StrategiaPubblicazione
  /** Client esterno scelto per ciascuna piattaforma. */
  visualizzatori?: Partial<Record<PiattaformaClient, string>>
  /** Client aggiunti a mano dall'utente. */
  visualizzatoriPersonali?: ClientEsterno[]
}

/** Campi mostrati in interfaccia, con la spiegazione di cosa cambiano. */
export interface CampoEndpoint {
  chiave: keyof OverrideEndpoint
  etichetta: string
  descrizione: string
  multiplo: boolean
  schema: 'wss' | 'https'
}

export const campiEndpoint: CampoEndpoint[] = [
  {
    chiave: 'NUXT_PUBLIC_DEFAULT_READ_RELAYS',
    etichetta: 'Relay di lettura',
    descrizione: 'Da qui arrivano feed, calendario, articoli e media.',
    multiplo: true,
    schema: 'wss',
  },
  {
    chiave: 'NUXT_PUBLIC_DEFAULT_WRITE_RELAYS',
    etichetta: 'Relay di scrittura',
    descrizione:
      'Destinazioni della pubblicazione, provate nell’ordine in cui sono scritte. Il primo dell’elenco è il primo tentativo.',
    multiplo: true,
    schema: 'wss',
  },
  {
    chiave: 'NUXT_PUBLIC_INDEXER_RELAYS',
    etichetta: 'Relay indicizzatori',
    descrizione: 'Usati per risolvere profili e liste di relay altrui (modello outbox).',
    multiplo: true,
    schema: 'wss',
  },
  {
    chiave: 'NUXT_PUBLIC_DRAFT_RELAY',
    etichetta: 'Relay per le bozze',
    descrizione:
      'Uno solo, e privato. Le bozze ci finiscono cifrate (NIP-37), quindi illeggibili a chi vi accede — ma il relay vede comunque quando e quanto scrivi. Lasciandolo vuoto restano solo le bozze salvate in questo browser: non esiste ripiego su un relay pubblico.',
    multiplo: false,
    schema: 'wss',
  },
  {
    chiave: 'NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS',
    etichetta: 'Server Blossom',
    descrizione:
      'Per i media. Il primo è il primario, gli altri ricevono la replica. Devono esporre gli header CORS sulla risposta effettiva, non solo sul preflight.',
    multiplo: true,
    schema: 'https',
  },
]

function leggiPersistito(): Persistito | null {
  if (!import.meta.client) return null
  try {
    const grezzo = localStorage.getItem(CHIAVE_STORAGE)
    return grezzo ? (JSON.parse(grezzo) as Persistito) : null
  } catch {
    return null
  }
}

export const useConfigurazione = defineStore('configurazione', () => {
  /** Valori del `.env`, iniettati dal runtimeConfig di Nuxt. */
  const daAmbiente = ref<RawEnv>({})
  const override = ref<OverrideEndpoint>({})
  const strategia = ref<StrategiaPubblicazione>('sequenziale')

  /**
   * Client esterni con cui aprire un evento gia' pubblicato.
   *
   * Due scelte distinte e non una sola, perche' il client giusto cambia con il
   * dispositivo: sulla scrivania si apre una scheda del browser, sul telefono
   * ha senso l'app installata. La preferenza viene applicata in base a come si
   * sta interagendo, non a un'impostazione da ricordare.
   */
  const visualizzatori = ref<Partial<Record<PiattaformaClient, string>>>({})
  const visualizzatoriPersonali = ref<ClientEsterno[]>([])

  /** Preset piu' quelli aggiunti a mano. */
  const visualizzatoriDisponibili = computed<ClientEsterno[]>(() => [
    ...clientEsterniPredefiniti,
    ...visualizzatoriPersonali.value,
  ])

  /** Client in vigore per una piattaforma, con ripiego sul predefinito. */
  function visualizzatorePer(piattaforma: PiattaformaClient): ClientEsterno {
    return risolviClient(
      visualizzatori.value[piattaforma],
      piattaforma,
      visualizzatoriPersonali.value,
    )
  }

  function impostaVisualizzatore(piattaforma: PiattaformaClient, id: string): void {
    visualizzatori.value = { ...visualizzatori.value, [piattaforma]: id }
    salva()
  }

  /**
   * Aggiunge o sostituisce un client scritto a mano.
   *
   * Il modello viene validato prima di entrare: finisce dentro un `href`, e
   * uno schema eseguibile diventerebbe codice cliccabile in pagina.
   */
  function aggiungiVisualizzatore(
    nome: string,
    template: string,
  ): { ok: true; id: string } | { ok: false; errore: string } {
    const problema = validaTemplate(template)
    if (problema) return { ok: false, errore: problema }
    if (nome.trim() === '') return { ok: false, errore: 'Dai un nome al client.' }

    const id = `mio-${nome
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`
    const nuovo: ClientEsterno = {
      id,
      nome: nome.trim(),
      template: template.trim(),
      piattaforme: ['desktop', 'app'],
    }
    visualizzatoriPersonali.value = [
      ...visualizzatoriPersonali.value.filter((c) => c.id !== id),
      nuovo,
    ]
    salva()
    return { ok: true, id }
  }

  function rimuoviVisualizzatore(id: string): void {
    visualizzatoriPersonali.value = visualizzatoriPersonali.value.filter((c) => c.id !== id)
    // Una piattaforma che puntava a questo client torna al predefinito, invece
    // di restare con un pulsante che non apre nulla.
    const ripulito = { ...visualizzatori.value }
    for (const [p, scelto] of Object.entries(ripulito)) {
      if (scelto === id) delete ripulito[p as PiattaformaClient]
    }
    visualizzatori.value = ripulito
    salva()
  }

  /** Vero se l'utente ha sostituito almeno un endpoint. */
  const personalizzata = computed(() =>
    Object.values(override.value).some((v) => v !== undefined && v !== null),
  )

  /** Forma grezza effettiva: ambiente con sopra le scelte dell'utente. */
  const grezza = computed<RawEnv>(() => {
    const unione: RawEnv = { ...daAmbiente.value }
    for (const [k, v] of Object.entries(override.value)) {
      if (v !== undefined) Object.assign(unione, { [k]: v })
    }
    return unione
  })

  const risolta = computed<{ valore: ClientConfig | null; errore: string | null }>(() => {
    try {
      return { valore: resolveClientConfig(grezza.value), errore: null }
    } catch (e) {
      return { valore: null, errore: e instanceof Error ? e.message : String(e) }
    }
  })

  const config = computed(() => risolta.value.valore)
  const errore = computed(() => risolta.value.errore)

  function inizializza(ambiente: RawEnv): void {
    daAmbiente.value = ambiente
    const salvato = leggiPersistito()
    if (salvato) {
      override.value = salvato.override ?? {}
      strategia.value = salvato.strategia ?? 'sequenziale'
      visualizzatori.value = salvato.visualizzatori ?? {}
      visualizzatoriPersonali.value = salvato.visualizzatoriPersonali ?? []
    }
  }

  function salva(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(
        CHIAVE_STORAGE,
        JSON.stringify({
          override: override.value,
          strategia: strategia.value,
        } satisfies Persistito),
      )
    } catch {
      // Storage pieno o negato: la scelta resta valida per questa sessione.
    }
  }

  /**
   * Applica un insieme di modifiche solo se il risultato e' valido.
   *
   * Tutto o niente: accettare le modifiche valide e scartare le altre
   * lascerebbe l'utente con una configurazione a meta', diversa da quella che
   * ha appena scritto e senza che nulla glielo dica.
   */
  function applica(modifiche: OverrideEndpoint): { ok: true } | { ok: false; errore: string } {
    const precedente = { ...override.value }
    const candidato: OverrideEndpoint = { ...override.value }
    for (const [k, v] of Object.entries(modifiche)) {
      // Stringa vuota su un campo multiplo significherebbe "nessun relay", che
      // la validazione rifiuta: si interpreta come "torna al default".
      if (v === undefined || (v.trim() === '' && k !== 'NUXT_PUBLIC_DRAFT_RELAY')) {
        delete candidato[k as keyof OverrideEndpoint]
      } else {
        Object.assign(candidato, { [k]: v })
      }
    }

    override.value = candidato
    if (errore.value) {
      const messaggio = errore.value
      override.value = precedente
      return { ok: false, errore: messaggio }
    }
    salva()
    return { ok: true }
  }

  /** Torna ai valori del `.env` per tutti i campi. */
  function ripristinaDefault(): void {
    override.value = {}
    salva()
  }

  function impostaStrategia(nuova: StrategiaPubblicazione): void {
    strategia.value = nuova
    salva()
  }

  /** Valore attualmente in vigore per un campo, comunque ci si sia arrivati. */
  function valoreDi(chiave: keyof OverrideEndpoint): string {
    return (grezza.value[chiave] ?? '').toString()
  }

  /** Se il campo e' stato sostituito dall'utente o viene ancora dall'ambiente. */
  function sovrascritto(chiave: keyof OverrideEndpoint): boolean {
    return override.value[chiave] !== undefined
  }

  return {
    override,
    strategia,
    visualizzatori,
    visualizzatoriPersonali,
    visualizzatoriDisponibili,
    visualizzatorePer,
    impostaVisualizzatore,
    aggiungiVisualizzatore,
    rimuoviVisualizzatore,
    config,
    errore,
    personalizzata,
    inizializza,
    applica,
    ripristinaDefault,
    impostaStrategia,
    valoreDi,
    sovrascritto,
  }
})
