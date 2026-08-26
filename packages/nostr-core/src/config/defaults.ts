import { z } from 'zod'

/**
 * Configurazione degli endpoint.
 *
 * Regola di progetto (ADR 0003): questi sono **default di primo avvio, mai
 * dipendenze**. L'utente deve poterli sostituire e ottenere un client
 * funzionante puntando altrove; le sue scelte vivono poi sui relay come
 * kind 10002 (NIP-65) e 10063 (Blossom BUD-03).
 *
 * I valori arrivano da variabili d'ambiente e non sono versionati: i
 * puntamenti privati restano fuori dal repository. Vedi `.env.example`.
 */

/**
 * Toglie gli slash finali.
 *
 * Un `https://esempio.tld/` copiaincollato produrrebbe poi `//upload` nelle
 * richieste Blossom, che alcuni server rifiutano. Normalizzare qui evita di
 * doverci pensare in ogni punto di chiamata.
 */
const senzaSlashFinale = (u: string): string => u.replace(/\/+$/, '')

const relayUrl = z
  .string()
  .trim()
  .refine((u) => u.startsWith('wss://') || u.startsWith('ws://'), {
    message: 'un URL di relay deve iniziare con wss:// (o ws:// in sviluppo)',
  })
  .transform(senzaSlashFinale)

const httpUrl = z
  .string()
  .trim()
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), {
    message: 'un URL di server deve iniziare con https:// (o http:// in sviluppo)',
  })
  .transform(senzaSlashFinale)

/** Trasforma "a, b ,c" in ["a","b","c"], scartando i vuoti. */
function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export const clientConfigSchema = z.object({
  /** Relay da cui leggere prima di conoscere la relay list dell'utente. */
  readRelays: z.array(relayUrl).min(1, 'serve almeno un relay di lettura'),

  /** Relay su cui pubblicare per default. */
  writeRelays: z.array(relayUrl).min(1, 'serve almeno un relay di scrittura'),

  /** Relay usati per risolvere profili e relay list altrui (outbox model). */
  indexerRelays: z.array(relayUrl),

  /**
   * Relay privato per le bozze long-form (kind 30024).
   *
   * `null` disabilita il salvataggio delle bozze in UI. Non esiste fallback su
   * relay pubblico: una bozza finita su un relay pubblico e' a tutti gli
   * effetti una pubblicazione non voluta.
   */
  draftRelay: relayUrl.nullable(),

  /** Server Blossom in ordine di preferenza; il primo e' il primario. */
  blossomServers: z.array(httpUrl),

  /** URL pubblico del client, per link canonici e meta tag Open Graph. */
  siteUrl: httpUrl,

  /** Gateway pubblico per i link di condivisione verso client terzi. */
  njumpUrl: httpUrl,
})

export type ClientConfig = z.infer<typeof clientConfigSchema>

/** Chiavi lette dall'ambiente. */
export interface RawEnv {
  NUXT_PUBLIC_DEFAULT_READ_RELAYS?: string | undefined
  NUXT_PUBLIC_DEFAULT_WRITE_RELAYS?: string | undefined
  NUXT_PUBLIC_INDEXER_RELAYS?: string | undefined
  NUXT_PUBLIC_DRAFT_RELAY?: string | undefined
  NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS?: string | undefined
  NUXT_PUBLIC_SITE_URL?: string | undefined
  NUXT_PUBLIC_NJUMP_URL?: string | undefined
}

/**
 * Costruisce la configurazione a partire dall'ambiente.
 *
 * Prende l'ambiente come parametro invece di leggere `process.env`: il core
 * deve restare isomorfico, e cosi' la funzione e' anche testabile senza
 * sporcare le variabili del processo.
 *
 * @throws se un valore e' malformato — meglio fallire all'avvio che scoprire
 *         a runtime che il client sta parlando con un endpoint sbagliato.
 */
export function resolveClientConfig(env: RawEnv): ClientConfig {
  const draft = env.NUXT_PUBLIC_DRAFT_RELAY?.trim()

  const parsed = clientConfigSchema.safeParse({
    readRelays: splitList(env.NUXT_PUBLIC_DEFAULT_READ_RELAYS),
    writeRelays: splitList(env.NUXT_PUBLIC_DEFAULT_WRITE_RELAYS),
    indexerRelays: splitList(env.NUXT_PUBLIC_INDEXER_RELAYS),
    draftRelay: draft && draft.length > 0 ? draft : null,
    blossomServers: splitList(env.NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS),
    siteUrl: env.NUXT_PUBLIC_SITE_URL?.trim() ?? 'http://localhost:3000',
    njumpUrl: env.NUXT_PUBLIC_NJUMP_URL?.trim() ?? 'https://njump.me',
  })

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(radice)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Configurazione degli endpoint non valida:\n${details}\n\nVedi .env.example`)
  }

  return parsed.data
}

/** Se il salvataggio delle bozze (kind 30024) puo' essere offerto in UI. */
export function draftsEnabled(config: ClientConfig): boolean {
  return config.draftRelay !== null
}
