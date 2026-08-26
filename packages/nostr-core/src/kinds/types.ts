import type { Event as NostrEvent, EventTemplate } from 'nostr-tools/pure'
import type { ZodType } from 'zod'

export type { NostrEvent, EventTemplate }

/**
 * Classe di un evento secondo NIP-01. Determina se e come l'evento puo' essere
 * sostituito, e quindi se il concetto di "modifica" ha senso per quel kind.
 *
 * - `regular`     — immutabile. Non esiste modifica: si puo' solo chiedere la
 *                   cancellazione (kind 5) e ripubblicare, ottenendo un id nuovo.
 * - `replaceable` — il relay tiene solo l'ultimo evento per (pubkey, kind).
 * - `addressable` — il relay tiene solo l'ultimo per (pubkey, kind, tag `d`).
 * - `ephemeral`   — non viene conservato dai relay.
 */
export type EventClass = 'regular' | 'replaceable' | 'addressable' | 'ephemeral'

/** Coordinata di un evento addressable: `<kind>:<pubkey>:<d>`. */
export type AddressPointer = `${number}:${string}:${string}`

/**
 * Contesto passato a `build()`. Contiene cio' che il kind non puo' dedurre da
 * solo ma non giustifica una dipendenza: chi sta scrivendo e quando.
 */
export interface BuildContext {
  /** Chiave pubblica dell'autore, esadecimale. */
  pubkey: string
  /** Timestamp unix in secondi. Iniettabile per rendere i test deterministici. */
  now: number
}

/** Come un kind partecipa ai feed cronologici. */
export interface FeedBehaviour {
  /** Se puo' comparire in un feed cronologico. */
  eligible: boolean
  /** Se va mostrato solo quando porta almeno un allegato `imeta` valido. */
  requiresMedia?: boolean
}

/**
 * Definizione di un kind: l'unita' di estensione del client.
 *
 * Aggiungere il supporto a un nuovo kind significa creare un file in
 * `kinds/definitions/` che esporta una di queste strutture e registrarla.
 * Nessun altro file dell'applicazione va toccato: il rendering passa da
 * `renderer`, i feed da `feed`, la validazione da `schema`.
 *
 * @typeParam TParsed - forma tipizzata dell'evento dopo il parsing.
 * @typeParam TInput  - dati applicativi da cui si costruisce l'evento.
 */
export interface KindDefinition<TParsed = unknown, TInput = unknown> {
  /** Numero del kind secondo la specifica. */
  readonly kind: number

  /** Nome leggibile, usato nei log e nella UI di debug. */
  readonly name: string

  /** NIP o BUD che lo definisce, per rintracciare la fonte (es. `NIP-52`). */
  readonly nip: string

  /**
   * Classe dichiarata. Viene verificata contro quella derivata dal numero:
   * una discrepanza e' un errore di registrazione, non un'opzione.
   */
  readonly class: EventClass

  /**
   * Se l'utente puo' modificare un evento gia' pubblicato.
   * Vero solo per `replaceable` e `addressable`: per gli altri il protocollo
   * non offre la modifica e la UI non deve simularla.
   */
  readonly editable: boolean

  /** Se ha senso offrire la richiesta di cancellazione NIP-09 (kind 5). */
  readonly deletable: boolean

  /** Schema di validazione del risultato di `parse()`. */
  readonly schema: ZodType<TParsed>

  /**
   * Estrae la forma tipizzata da un evento grezzo.
   * Deve lanciare se l'evento non e' valido per questo kind.
   */
  parse(event: NostrEvent): TParsed

  /** Costruisce il template non firmato. La firma avviene altrove. */
  build(input: TInput, ctx: BuildContext): EventTemplate

  /**
   * Valore del tag `d` per gli eventi addressable.
   * Obbligatorio se `class` e' `addressable`, vietato altrimenti.
   */
  identifier?(input: TInput): string

  /** Partecipazione ai feed. Assente significa "non compare nei feed". */
  readonly feed?: FeedBehaviour

  /**
   * Chiave del componente di rendering, risolta da `KindRenderer.vue`.
   * Assente significa che si usa il renderer di fallback.
   */
  readonly renderer?: string
}

/** Definizione con i tipi cancellati, per stoccarla in modo omogeneo. */
// Un registry deve poter contenere definizioni con parametri diversi fra loro:
// `any` qui e' deliberato e circoscritto a questo alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyKindDefinition = KindDefinition<any, any>
