import { getKindDefinition, identifier, type NostrEvent } from '@nmc/nostr-core'

/**
 * Dove si va per rimettere mano a un evento gia' pubblicato.
 *
 * La distinzione fondamentale non e' "quale kind": e' la **classe** dell'evento
 * secondo NIP-01, e il registry la conosce gia'.
 *
 *  - `replaceable` e `addressable` si **modificano davvero**: ripubblicando con
 *    la stessa coordinata il relay sostituisce la versione precedente, e id,
 *    reazioni e risposte restano appesi alla stessa coordinata.
 *  - i `regular` — nota, immagini, video, schede file — sono **immutabili**.
 *    Non e' una limitazione di questo client: il protocollo non prevede la
 *    sostituzione, e l'unica cosa che si puo' fare e' pubblicarne uno nuovo,
 *    che avra' un id diverso e nessuna delle reazioni ricevute.
 *
 * Confondere le due cose e' l'errore che il piano vieta esplicitamente: la UI
 * non deve simulare una modifica che il protocollo non offre.
 */

export type AzioneEvento =
  | { tipo: 'modifica'; rotta: string; etichetta: string }
  | { tipo: 'ripubblica'; rotta: string; etichetta: string; avviso: string }
  | { tipo: 'nessuna'; avviso: string }

/** Rotta del form che sa comporre questo kind, con la coordinata da riaprire. */
function rottaPerKind(evento: NostrEvent, d: string): string | null {
  switch (evento.kind) {
    case 0:
      return '/profilo'
    case 30023:
    case 30024:
      return `/articoli/nuovo?d=${encodeURIComponent(d)}`
    case 31922:
    case 31923:
      return `/calendario/nuovo?d=${encodeURIComponent(d)}&kind=${evento.kind}`
    case 31925:
      return `/calendario/rsvp?d=${encodeURIComponent(d)}`
    case 20:
    case 21:
    case 22:
    case 1063:
      // Regolare: non si modifica. Si puo' pero' ricomporne uno nuovo dagli
      // stessi file, che sono gia' su Blossom e non vanno ricaricati.
      return `/media/nuovo?da=${evento.id}`
    default:
      return null
  }
}

export function azionePerEvento(evento: NostrEvent): AzioneEvento {
  const definizione = getKindDefinition(evento.kind)
  const d = definizione?.class === 'addressable' ? identifier(evento) : ''
  const rotta = rottaPerKind(evento, d)

  if (definizione?.editable === true && rotta) {
    return { tipo: 'modifica', rotta, etichetta: 'Modifica' }
  }

  if (rotta) {
    return {
      tipo: 'ripubblica',
      rotta,
      etichetta: 'Ripubblica come nuovo',
      avviso:
        'Gli eventi con media sono regolari, quindi immutabili: questo ne compone uno nuovo con gli stessi file, che avrà un id diverso e nessuna delle reazioni ricevute.',
    }
  }

  if (evento.kind === 1) {
    return {
      tipo: 'nessuna',
      avviso:
        'Una nota è un evento regolare: il protocollo non prevede la sostituzione. Correggerla significa chiederne la cancellazione e ripubblicarla, ottenendo un id nuovo e perdendo risposte e reazioni.',
    }
  }

  return {
    tipo: 'nessuna',
    avviso: `Questo client non ha un modulo di composizione per il kind ${evento.kind}.`,
  }
}
