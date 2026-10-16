import { z } from 'zod'

/**
 * Endpoint configuration.
 *
 * Project rule (ADR 0003): these are **first-run defaults, never
 * dependencies**. The user must be able to replace them and get a working
 * client pointing elsewhere; their choices then live on the relays as kind
 * 10002 (NIP-65) and 10063 (Blossom BUD-03).
 *
 * The values come from environment variables and are not versioned: private
 * endpoints stay out of the repository. See `.env.example`.
 *
 * The validation messages stay in Italian: they reach the settings page and
 * the diagnostics, which the user reads.
 */

/**
 * Drops trailing slashes.
 *
 * A pasted `https://example.tld/` would later produce `//upload` in Blossom
 * requests, which some servers refuse. Normalising here saves having to think
 * about it at every call site.
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

/** Turns "a, b ,c" into ["a","b","c"], dropping the empty ones. */
function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export const clientConfigSchema = z.object({
  /** Relays to read from before the user's relay list is known. */
  readRelays: z.array(relayUrl).min(1, 'serve almeno un relay di lettura'),

  /** Relays to publish to by default. */
  writeRelays: z.array(relayUrl).min(1, 'serve almeno un relay di scrittura'),

  /** Relays used to resolve other people's profiles and relay lists (outbox model). */
  indexerRelays: z.array(relayUrl),

  /**
   * The private relay for long-form drafts (kind 30024).
   *
   * `null` disables saving drafts in the UI. There is no fallback onto a
   * public relay: a draft that ends up on a public relay is, to all intents
   * and purposes, a publication nobody wanted.
   */
  draftRelay: relayUrl.nullable(),

  /** Blossom servers in order of preference; the first is the primary one. */
  blossomServers: z.array(httpUrl),

  /** The client's public URL, for canonical links and Open Graph meta tags. */
  siteUrl: httpUrl,

  /** The public gateway for sharing links towards third-party clients. */
  njumpUrl: httpUrl,
})

export type ClientConfig = z.infer<typeof clientConfigSchema>

/** The keys read from the environment. */
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
 * Builds the configuration from the environment.
 *
 * It takes the environment as a parameter instead of reading `process.env`:
 * the core has to stay isomorphic, and this way the function is also testable
 * without touching the process variables.
 *
 * @throws if a value is malformed — better to fail at startup than to find
 *         out at runtime that the client is talking to the wrong endpoint.
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
    // Italian for the same reason as the messages above: this one reaches the
    // settings page and the diagnostics, which the user reads.
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(radice)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Configurazione degli endpoint non valida:\n${details}\n\nVedi .env.example`)
  }

  return parsed.data
}

/** Whether saving drafts (kind 30024) can be offered in the UI. */
export function draftsEnabled(config: ClientConfig): boolean {
  return config.draftRelay !== null
}
