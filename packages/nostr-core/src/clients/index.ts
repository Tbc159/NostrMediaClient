import { naddrEncode, neventEncode, nprofileEncode, npubEncode } from 'nostr-tools/nip19'

import { classifyKind } from '../kinds/classify.js'
import { identifier } from '../kinds/tags.js'
import type { NostrEvent } from '../kinds/types.js'

/**
 * Opening an event in an external Nostr client.
 *
 * This client is for *managing* your own content, not for reading it the way
 * the rest of the network reads it. To see a publication as the others see it
 * you need a reading client, and choosing which one is not up to us: everyone
 * has their own, and it changes between desk and phone.
 *
 * Hence the design based on **a URL template with a placeholder** instead of a
 * closed list: the presets cover the common cases, but any client at all is
 * added by pasting its format, without waiting for a new version of ours.
 */

/** Where the client is used. It decides which preference applies. */
export type PiattaformaClient = 'desktop' | 'app'

/**
 * The NIP-19 form an event is referred to by from outside.
 *
 * It is not an internal detail: **some clients have a different path for each
 * form**, and using the wrong one leads to an error page. That is the case
 * with Primal, which opens events from `/e/` and profiles from `/p/`.
 */
export type TipoPuntatore = 'nevent' | 'naddr' | 'nprofile'

export interface ClientEsterno {
  id: string
  nome: string
  /**
   * The URL's template. `{pointer}` is replaced by the NIP-19 identifier
   * (`nevent`, `naddr` or `nprofile`) of the event to open.
   */
  template: string
  /**
   * Alternative templates for the forms the client treats separately.
   *
   * It is worth having because the case really exists: Primal answers `404` to
   * `/e/nprofile1…`. Whoever does not declare it uses `template` for
   * everything, which is what the majority of clients do.
   */
  templatePerTipo?: Partial<Record<TipoPuntatore, string>>
  /**
   * The kinds the client **cannot display**, verified by actually loading them.
   *
   * It is declared in the negative on purpose: a missing kind means «not known
   * to be broken», not «supported». Listing the supported kinds would be a
   * promise nobody can keep — clients add them all the time — and would turn
   * every novelty into a button that disappears.
   */
  kindsNonSupportati?: readonly number[]
  /**
   * The kinds the client exists for, when it is a specialised reader.
   *
   * The opposite of `kindsNonSupportati`, and it serves one case only: a
   * podcast player can display episodes and show cards, and nothing else.
   * Offering it for a note would be a button that opens an empty page.
   */
  soloKinds?: readonly number[]
  /** The platforms it makes sense to offer it as the default on. Empty: never the default, a fallback only. */
  piattaforme: PiattaformaClient[]
  nota?: string
}

/**
 * Presets verified against the real clients, not derived from the documentation.
 *
 * The verification was redone by loading every template in a browser with real
 * pointers of **all three** forms, and that is how two defects came out that
 * testing with an `nevent` alone did not show: noStrudel answers «Unknown type
 * naddr» on the `/n/` path, which is a note's view, and Primal answers `404`
 * to an `nprofile` on the `/e/` path.
 *
 * The lesson, for whoever adds a preset: **try every form**. A link to a note
 * that works says nothing about a link to an article.
 */
export const clientEsterniPredefiniti: readonly ClientEsterno[] = [
  {
    id: 'nostrudel',
    nome: 'noStrudel',
    template: 'https://nostrudel.ninja/l/{pointer}',
    // It displays notes, profiles, images, articles and file cards. On video,
    // podcast and calendar it answers «Unknown event kind»: the raw text is
    // all that is left, with no player, no date and no place.
    kindsNonSupportati: [21, 22, 54, 31922, 31923, 31925],
    piattaforme: ['desktop'],
    nota: 'Client web completo. Il percorso /l/ smista da solo note, articoli, immagini e profili; /n/ è la sola vista delle note e rifiuta il resto.',
  },
  {
    id: 'primal',
    nome: 'Primal',
    template: 'https://primal.net/e/{pointer}',
    templatePerTipo: { nprofile: 'https://primal.net/p/{pointer}' },
    piattaforme: ['app', 'desktop'],
    nota: 'Ha app native: su telefono il link si apre nell’app se è installata. I profili stanno su /p/, gli eventi su /e/.',
  },
  {
    id: 'njump',
    nome: 'njump',
    template: 'https://njump.me/{pointer}',
    piattaforme: ['desktop', 'app'],
    nota: 'Gateway che rende l’evento lato server: utile per condividere un link che mostri un’anteprima. È l’unico che non ha mai restituito un errore, su nessun tipo provato.',
  },
  {
    id: 'coracle',
    nome: 'Coracle',
    template: 'https://coracle.social/{pointer}',
    // It covers what noStrudel lacks: video, podcast and calendar. Of the
    // events with a time it also shows start, end and place. On a file card
    // and an RSVP it renders an empty page.
    kindsNonSupportati: [1063, 31925],
    piattaforme: ['desktop'],
    nota: 'Mostra i tipi che noStrudel non conosce: video, episodi di podcast ed eventi da calendario, con data e luogo.',
  },
  {
    id: 'snort',
    nome: 'Snort',
    template: 'https://snort.social/{pointer}',
    // On the events with a time it says explicitly that it does not know the kind.
    kindsNonSupportati: [31923],
    piattaforme: ['desktop'],
  },
  {
    id: 'transmit',
    nome: 'Transmit',
    // A Nostr podcast player (NIP-F4): it does not have a page per event but
    // per *show*, which is the key. The placeholder is therefore the author's
    // npub, and the same page serves an episode and the 10154 card alike.
    template: 'https://www.transmit.fm/shows/{npub}',
    soloKinds: [54, 10154],
    piattaforme: [],
    nota: 'Lettore di podcast Nostr. Apre la pagina dello show, non del singolo episodio, e legge da relay.damus.io: scheda ed episodi devono stare anche lì.',
  },
  {
    id: 'nostr-uri',
    nome: 'App installata sul dispositivo',
    template: 'nostr:{pointer}',
    piattaforme: ['app'],
    nota: 'Usa lo schema nostr: di NIP-21 e lascia scegliere al sistema operativo. Non apre nulla se non c’è un’app registrata.',
  },
]

export const CLIENT_PREDEFINITO: Record<PiattaformaClient, string> = {
  desktop: 'nostrudel',
  app: 'primal',
}

/**
 * The NIP-19 identifier an event is referred to by from outside.
 *
 * The form depends on the event's class, and getting it wrong means sending
 * the user to an empty page:
 *
 *  - **addressable** → `naddr`, which points at the *coordinate*. An `nevent`
 *    would point at a superseded version as soon as the event is edited.
 *  - **profile** (kind 0) → `nprofile`, because clients have a page for the
 *    profile, not for the event that describes it.
 *  - everything else → `nevent`, with the id.
 *
 * The relays end up inside the identifier as **hints**: without them the
 * external client looks for the event on its own relays alone and often does
 * not find it. It is the practical difference between a link that works and
 * one that opens nothing.
 */
export function tipoPuntatorePer(evento: NostrEvent): TipoPuntatore {
  if (evento.kind === 0) return 'nprofile'
  if (classifyKind(evento.kind) === 'addressable') return 'naddr'
  return 'nevent'
}

export function nip19PointerFor(evento: NostrEvent, relays: readonly string[] = []): string {
  // Few hints, and good ones: some clients query them all, and a very long
  // identifier is also unpleasant to share.
  const suggerimenti = [...new Set(relays)].slice(0, 3)

  if (evento.kind === 0) {
    return nprofileEncode({
      pubkey: evento.pubkey,
      ...(suggerimenti.length ? { relays: suggerimenti } : {}),
    })
  }

  if (classifyKind(evento.kind) === 'addressable') {
    return naddrEncode({
      identifier: identifier(evento),
      pubkey: evento.pubkey,
      kind: evento.kind,
      ...(suggerimenti.length ? { relays: suggerimenti } : {}),
    })
  }

  return neventEncode({
    id: evento.id,
    author: evento.pubkey,
    kind: evento.kind,
    ...(suggerimenti.length ? { relays: suggerimenti } : {}),
  })
}

/** Replaces the placeholder in the template. */
export function componiLinkEsterno(
  template: string,
  pointer: string,
  extra: { npub?: string } = {},
): string {
  const modello = template.trim()
  if (!modello.includes('{pointer}') && !modello.includes('{npub}')) {
    throw new Error(
      'Il modello deve contenere {pointer} — l’identificatore dell’evento — oppure {npub}, la chiave dell’autore.',
    )
  }
  if (modello.includes('{npub}') && !extra.npub) {
    throw new Error('Il modello usa {npub} ma non si conosce l’autore dell’evento.')
  }
  return modello.replace('{pointer}', pointer).replace('{npub}', extra.npub ?? '')
}

/**
 * The order of the fallbacks, from the most complete to the most generic.
 *
 * It is an explicit list and not «the first preset that fits» because falling
 * back on an untested client would only move the problem: you would end up on
 * another broken page, with the added impression that the chosen client was to
 * blame. These two were loaded with real events of every type.
 */
const RIPIEGHI: readonly string[] = ['coracle', 'njump']
/** For some kinds a purpose-built player exists: it comes before the social clients. */
const RIPIEGHI_PER_KIND: Readonly<Record<number, readonly string[]>> = {
  54: ['transmit', ...RIPIEGHI],
  10154: ['transmit', ...RIPIEGHI],
}

/** True when the client, by its own declaration, does not display this kind. */
function nonMostra(client: ClientEsterno, kind: number): boolean {
  if (client.soloKinds && !client.soloKinds.includes(kind)) return true
  return client.kindsNonSupportati?.includes(kind) ?? false
}

/**
 * The client this event should actually be opened with.
 *
 * A reading client knows the kinds it knows, and none of them knows them all:
 * noStrudel displays neither video, nor podcast, nor calendar events, and
 * renders them as raw text under the words «Unknown event kind». Opening a
 * calendar event there means losing exactly the information it exists for —
 * date, time, place.
 *
 * Instead of leaving the user a button that leads to a lifeless page, we fall
 * back on a client that does display that kind, and we say so: `sostituito`
 * carries the client that had been chosen, so the interface can explain why
 * the name on the button changed.
 */
export function clientPerEvento(
  scelto: ClientEsterno,
  evento: NostrEvent,
  disponibili: readonly ClientEsterno[] = clientEsterniPredefiniti,
): { client: ClientEsterno; sostituito: ClientEsterno | null } {
  const perKind = RIPIEGHI_PER_KIND[evento.kind]
  // A purpose-built player wins over the chosen social client even when the
  // latter is «not known to be broken»: showing an episode as text is not
  // showing it. Whoever chose a player in the first place keeps it, though.
  const lettore = perKind ? disponibili.find((c) => c.id === perKind[0]) : undefined
  if (lettore && lettore.id !== scelto.id && !nonMostra(lettore, evento.kind)) {
    return { client: lettore, sostituito: scelto }
  }

  if (!nonMostra(scelto, evento.kind)) return { client: scelto, sostituito: null }

  for (const id of perKind ?? RIPIEGHI) {
    const ripiego = disponibili.find((c) => c.id === id)
    if (!ripiego || ripiego.id === scelto.id) continue
    if (nonMostra(ripiego, evento.kind)) continue
    return { client: ripiego, sostituito: scelto }
  }

  // No better fallback: the chosen client, which at least shows the raw text,
  // is better than no button at all.
  return { client: scelto, sostituito: null }
}

/** The right template for this event, allowing for the forms treated separately. */
export function templatePerEvento(client: ClientEsterno, evento: NostrEvent): string {
  return client.templatePerTipo?.[tipoPuntatorePer(evento)] ?? client.template
}

/**
 * A direct link to an event for an external client.
 *
 * It accepts the whole client — which is the form to prefer, because it is the
 * only one that knows which forms that client treats separately — or a
 * template alone, to preview a hand-written template that is not a client yet.
 */
export function linkEventoEsterno(
  client: ClientEsterno | string,
  evento: NostrEvent,
  relays: readonly string[] = [],
): string {
  const modello = typeof client === 'string' ? client : templatePerEvento(client, evento)
  return componiLinkEsterno(modello, nip19PointerFor(evento, relays), {
    npub: npubEncode(evento.pubkey),
  })
}

/**
 * Checks a hand-written template.
 *
 * `https:` and the apps' custom schemes (`nostr:`, `primal:`) are accepted,
 * but **not** `javascript:` and the like: a template ends up in an `href`, and
 * an executable scheme would become clickable code.
 */
export function validaTemplate(template: string): string | null {
  const t = template.trim()
  if (t === '') return 'Il modello e’ vuoto.'
  if (!t.includes('{pointer}') && !t.includes('{npub}')) {
    return 'Manca il segnaposto {pointer} (o {npub}, per i client che hanno una pagina per autore).'
  }

  const schema = t.slice(0, t.indexOf(':')).toLowerCase()
  if (t.indexOf(':') < 1) return 'Il modello deve iniziare con uno schema, per esempio https://.'

  const ammessi = ['https', 'http', 'nostr', 'web+nostr']
  if (!ammessi.includes(schema)) {
    return `Schema "${schema}:" non ammesso. Usa https:// oppure nostr:.`
  }
  return null
}

/** The chosen client, or the platform's default when it is no longer among the presets. */
export function risolviClient(
  id: string | undefined,
  piattaforma: PiattaformaClient,
  personalizzati: readonly ClientEsterno[] = [],
): ClientEsterno {
  const tutti = [...clientEsterniPredefiniti, ...personalizzati]
  const scelto = id ? tutti.find((c) => c.id === id) : undefined
  if (scelto) return scelto

  const predefinito = tutti.find((c) => c.id === CLIENT_PREDEFINITO[piattaforma])
  // The last safety net: a preset always exists, but the type does not know it.
  return predefinito ?? (clientEsterniPredefiniti[0] as ClientEsterno)
}
