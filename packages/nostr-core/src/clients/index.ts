import { naddrEncode, neventEncode, nprofileEncode } from 'nostr-tools/nip19'

import { classifyKind } from '../kinds/classify.js'
import { identifier } from '../kinds/tags.js'
import type { NostrEvent } from '../kinds/types.js'

/**
 * Apertura di un evento in un client Nostr esterno.
 *
 * Questo client serve a *gestire* i propri contenuti, non a leggerli come li
 * legge il resto della rete. Per vedere una pubblicazione come la vedono gli
 * altri serve un client di lettura, e la scelta di quale non e' nostra: ognuno
 * ha il suo, e cambia fra scrivania e telefono.
 *
 * Da qui il modello a **modello di URL con segnaposto** invece di un elenco
 * chiuso: i preset coprono i casi comuni, ma qualunque client si aggiunge
 * incollando il suo formato, senza aspettare una nostra versione nuova.
 */

/** Dove il client viene usato. Determina quale preferenza si applica. */
export type PiattaformaClient = 'desktop' | 'app'

/**
 * Forma NIP-19 con cui ci si riferisce a un evento dall'esterno.
 *
 * Non e' un dettaglio interno: **alcuni client hanno un percorso diverso per
 * ciascuna forma**, e usare quello sbagliato porta a una pagina d'errore. E'
 * il caso di Primal, che apre gli eventi da `/e/` e i profili da `/p/`.
 */
export type TipoPuntatore = 'nevent' | 'naddr' | 'nprofile'

export interface ClientEsterno {
  id: string
  nome: string
  /**
   * Modello dell'URL. `{pointer}` viene sostituito dall'identificatore NIP-19
   * (`nevent`, `naddr` o `nprofile`) dell'evento da aprire.
   */
  template: string
  /**
   * Modelli alternativi per le forme che il client tratta a parte.
   *
   * Vale la pena averlo perche' il caso esiste davvero: Primal risponde `404`
   * a `/e/nprofile1…`. Chi non lo dichiara usa `template` per tutto, che e'
   * quello che fa la maggioranza dei client.
   */
  templatePerTipo?: Partial<Record<TipoPuntatore, string>>
  /** Piattaforme per cui ha senso proporlo come predefinito. */
  piattaforme: PiattaformaClient[]
  nota?: string
}

/**
 * Preset verificati contro i client veri, non ricavati dalla documentazione.
 *
 * La verifica e' stata rifatta caricando ogni modello in un browser con
 * puntatori reali di **tutte e tre** le forme, ed e' cosi' che sono emersi due
 * difetti che la sola prova con un `nevent` non mostrava: noStrudel risponde
 * «Unknown type naddr» sul percorso `/n/`, che e' la vista di una nota, e
 * Primal risponde `404` a un `nprofile` sul percorso `/e/`.
 *
 * La lezione, per chi aggiungera' un preset: **provare tutte le forme**. Un
 * link a una nota che funziona non dice nulla su un link a un articolo.
 */
export const clientEsterniPredefiniti: readonly ClientEsterno[] = [
  {
    id: 'nostrudel',
    nome: 'noStrudel',
    template: 'https://nostrudel.ninja/l/{pointer}',
    piattaforme: ['desktop'],
    nota: 'Client web completo. Il percorso /l/ smista da solo note, articoli e profili; /n/ è la sola vista delle note e rifiuta il resto.',
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
    nota: 'Gateway che rende l’evento lato server: utile per condividere un link che mostri un’anteprima.',
  },
  {
    id: 'coracle',
    nome: 'Coracle',
    template: 'https://coracle.social/{pointer}',
    piattaforme: ['desktop'],
  },
  {
    id: 'snort',
    nome: 'Snort',
    template: 'https://snort.social/{pointer}',
    piattaforme: ['desktop'],
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
 * Identificatore NIP-19 con cui riferirsi a un evento dall'esterno.
 *
 * La forma dipende dalla classe dell'evento, e sbagliarla significa mandare
 * l'utente su una pagina vuota:
 *
 *  - **addressable** → `naddr`, che punta alla *coordinata*. Un `nevent`
 *    punterebbe a una versione superata non appena l'evento viene modificato.
 *  - **profilo** (kind 0) → `nprofile`, perche' i client hanno una pagina per
 *    il profilo, non per l'evento che lo descrive.
 *  - tutto il resto → `nevent`, con l'id.
 *
 * I relay finiscono dentro l'identificatore come **suggerimenti**: senza, il
 * client esterno cerca l'evento solo sui propri relay e spesso non lo trova.
 * E' la differenza pratica fra un link che funziona e uno che apre il vuoto.
 */
export function tipoPuntatorePer(evento: NostrEvent): TipoPuntatore {
  if (evento.kind === 0) return 'nprofile'
  if (classifyKind(evento.kind) === 'addressable') return 'naddr'
  return 'nevent'
}

export function nip19PointerFor(evento: NostrEvent, relays: readonly string[] = []): string {
  // Pochi suggerimenti e buoni: alcuni client li interrogano tutti, e un
  // identificatore lunghissimo e' anche sgradevole da condividere.
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

/** Sostituisce il segnaposto nel modello. */
export function componiLinkEsterno(template: string, pointer: string): string {
  const modello = template.trim()
  if (!modello.includes('{pointer}')) {
    throw new Error(
      'Il modello deve contenere {pointer}, che e’ il punto in cui viene inserito l’identificatore dell’evento.',
    )
  }
  return modello.replace('{pointer}', pointer)
}

/** Il modello giusto per questo evento, tenendo conto delle forme trattate a parte. */
export function templatePerEvento(client: ClientEsterno, evento: NostrEvent): string {
  return client.templatePerTipo?.[tipoPuntatorePer(evento)] ?? client.template
}

/**
 * Link diretto a un evento per un client esterno.
 *
 * Accetta il client intero — che e' la forma da preferire, perche' e' l'unica
 * che sa quali forme quel client tratta a parte — oppure un modello soltanto,
 * per l'anteprima di un modello scritto a mano che ancora non e' un client.
 */
export function linkEventoEsterno(
  client: ClientEsterno | string,
  evento: NostrEvent,
  relays: readonly string[] = [],
): string {
  const modello = typeof client === 'string' ? client : templatePerEvento(client, evento)
  return componiLinkEsterno(modello, nip19PointerFor(evento, relays))
}

/**
 * Controlla un modello scritto a mano.
 *
 * Si accettano `https:` e gli schemi personalizzati delle app (`nostr:`,
 * `primal:`), ma **non** `javascript:` e simili: un modello finisce in un
 * `href`, e uno schema eseguibile diventerebbe codice cliccabile.
 */
export function validaTemplate(template: string): string | null {
  const t = template.trim()
  if (t === '') return 'Il modello e’ vuoto.'
  if (!t.includes('{pointer}')) return 'Manca il segnaposto {pointer}.'

  const schema = t.slice(0, t.indexOf(':')).toLowerCase()
  if (t.indexOf(':') < 1) return 'Il modello deve iniziare con uno schema, per esempio https://.'

  const ammessi = ['https', 'http', 'nostr', 'web+nostr']
  if (!ammessi.includes(schema)) {
    return `Schema "${schema}:" non ammesso. Usa https:// oppure nostr:.`
  }
  return null
}

/** Il client scelto, o il predefinito della piattaforma se non e' piu' fra i preset. */
export function risolviClient(
  id: string | undefined,
  piattaforma: PiattaformaClient,
  personalizzati: readonly ClientEsterno[] = [],
): ClientEsterno {
  const tutti = [...clientEsterniPredefiniti, ...personalizzati]
  const scelto = id ? tutti.find((c) => c.id === id) : undefined
  if (scelto) return scelto

  const predefinito = tutti.find((c) => c.id === CLIENT_PREDEFINITO[piattaforma])
  // L'ultima rete di sicurezza: un preset esiste sempre, ma il tipo non lo sa.
  return predefinito ?? (clientEsterniPredefiniti[0] as ClientEsterno)
}
