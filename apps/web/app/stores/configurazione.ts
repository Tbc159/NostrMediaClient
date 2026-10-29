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
 * The client's effective endpoints: the environment's defaults plus the user's
 * choices.
 *
 * The `.env` values stay what the plan says they are — **first-run defaults,
 * never dependencies**. On top of them is laid what the user decides from the
 * settings, which lives in their browser and not in the repository.
 *
 * The overlaying happens on the *raw* form (the environment's comma-separated
 * strings) and not on the already validated object: that way the validation
 * stays the single one in `resolveClientConfig`, shared between the app, SSR
 * and the command-line scripts, instead of being rewritten here in a variant
 * that would diverge over time.
 */

const CHIAVE_STORAGE = 'nmc.endpoint'

/** The fields the user can override, in the environment's form. */
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
  /** The external client chosen for each platform. */
  visualizzatori?: Partial<Record<PiattaformaClient, string>>
  /** Client aggiunti a mano dall'utente. */
  visualizzatoriPersonali?: ClientEsterno[]
}

/** The fields shown in the interface, with an explanation of what they change. */
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
  /** The `.env` values, injected by Nuxt's runtimeConfig. */
  const daAmbiente = ref<RawEnv>({})
  const override = ref<OverrideEndpoint>({})
  const strategia = ref<StrategiaPubblicazione>('sequenziale')

  /**
   * The external clients to open an already published event with.
   *
   * Two distinct choices and not one, because the right client changes with
   * the device: on the desk a browser tab opens, on the phone the installed
   * app makes sense. The preference is applied according to how you are
   * interacting, not to a setting you have to remember.
   */
  const visualizzatori = ref<Partial<Record<PiattaformaClient, string>>>({})
  const visualizzatoriPersonali = ref<ClientEsterno[]>([])

  /** The presets plus the ones added by hand. */
  const visualizzatoriDisponibili = computed<ClientEsterno[]>(() => [
    ...clientEsterniPredefiniti,
    ...visualizzatoriPersonali.value,
  ])

  /** The client in force for a platform, falling back on the default. */
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
   * Adds or replaces a hand-written client.
   *
   * The template is validated before it goes in: it ends up inside an `href`,
   * and an executable scheme would become clickable code in the page.
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
    // A platform that pointed at this client goes back to the default,
    // instead of being left with a button that opens nothing.
    const ripulito = { ...visualizzatori.value }
    for (const [p, scelto] of Object.entries(ripulito)) {
      if (scelto === id) delete ripulito[p as PiattaformaClient]
    }
    visualizzatori.value = ripulito
    salva()
  }

  /** True when the user has replaced at least one endpoint. */
  const personalizzata = computed(() =>
    Object.values(override.value).some((v) => v !== undefined && v !== null),
  )

  /** The effective raw form: the environment with the user's choices on top. */
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
      // Storage full or denied: the choice holds for this session.
    }
  }

  /**
   * Applies a set of changes only when the result is valid.
   *
   * All or nothing: accepting the valid changes and discarding the others
   * would leave the user with half a configuration, different from the one
   * they have just written and with nothing to tell them so.
   */
  function applica(modifiche: OverrideEndpoint): { ok: true } | { ok: false; errore: string } {
    const precedente = { ...override.value }
    const candidato: OverrideEndpoint = { ...override.value }
    for (const [k, v] of Object.entries(modifiche)) {
      // An empty string on a multiple field would mean "no relays", which the
      // validation refuses: it is read as "go back to the default".
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

  /** Goes back to the `.env` values for every field. */
  function ripristinaDefault(): void {
    override.value = {}
    salva()
  }

  function impostaStrategia(nuova: StrategiaPubblicazione): void {
    strategia.value = nuova
    salva()
  }

  /** The value currently in force for a field, however it was arrived at. */
  function valoreDi(chiave: keyof OverrideEndpoint): string {
    return (grezza.value[chiave] ?? '').toString()
  }

  /** Whether the field was replaced by the user or still comes from the environment. */
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
