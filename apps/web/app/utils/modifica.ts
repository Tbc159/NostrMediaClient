import { getKindDefinition, identifier, type NostrEvent } from '@nmc/nostr-core'

/**
 * Where you go to put your hand to an already published event again.
 *
 * The fundamental distinction is not "which kind": it is the event's **class**
 * under NIP-01, and the registry knows it already.
 *
 *  - `replaceable` and `addressable` are **really editable**: on republishing
 *    with the same coordinate the relay replaces the previous version, and the
 *    id, the reactions and the replies stay hung on the same coordinate.
 *  - the `regular` ones — a note, images, video, file cards — are
 *    **immutable**. It is not a limitation of this client: the protocol has no
 *    replacement, and the only thing to be done is to publish a new one, which
 *    will have a different id and none of the reactions received.
 *
 * Confusing the two is the mistake the plan explicitly forbids: the UI must
 * not simulate an edit the protocol does not offer.
 */

export type AzioneEvento =
  | { tipo: 'modifica'; rotta: string; etichetta: string }
  | { tipo: 'ripubblica'; rotta: string; etichetta: string; avviso: string }
  | { tipo: 'nessuna'; avviso: string }

/** The route of the form that can compose this kind, with the coordinate to reopen. */
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
      // Regular: not editable. A new one can be recomposed, though, from the
      // same files, which are on Blossom already and need no re-uploading.
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
