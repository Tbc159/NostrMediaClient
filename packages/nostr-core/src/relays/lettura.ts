/**
 * Da quali relay leggere un evento.
 *
 * Non tutti i relay servono a tutto. Gli **indicizzatori** — purplepag.es,
 * user.kindpag.es — non conservano note ne' articoli: tengono i dati con cui
 * si trova una persona, cioe' il profilo (kind 0), la sua lista di relay
 * (NIP-65, kind 10002), i server Blossom che dichiara (BUD-03, kind 10063) e
 * i follow (kind 3). Sono pochi kind, replaceable, minuscoli, e sono esposti
 * proprio perche' un client li possa leggere senza sapere niente di quella
 * chiave.
 *
 * Il caso vero che ha portato a questo modulo: un profilo pubblicato mesi
 * prima era sopravvissuto **solo** sugli indicizzatori, mentre i relay di
 * contenuto lo avevano lasciato cadere. Il client, che interrogava solo i
 * propri relay di lettura e scrittura, mostrava l'npub al posto del nome e
 * apriva un form del profilo vuoto — con l'avviso che pubblicando si
 * sovrascrive, ma senza dire che il profilo c'era, altrove. Chiedere agli
 * indicizzatori costa una connessione e risolve la classe di problema.
 */

/**
 * I kind che gli indicizzatori conservano, e per i quali vale interrogarli.
 *
 * Deliberatamente corto: chiedere a un indicizzatore un kind che non tiene
 * significa aspettare un EOSE vuoto per niente.
 */
export const KIND_DA_INDICIZZATORI: readonly number[] = [0, 3, 10002, 10063]

export interface RelayConfigurati {
  readRelays: readonly string[]
  writeRelays: readonly string[]
  indexerRelays: readonly string[]
}

/**
 * I relay da interrogare per un kind, senza doppioni e nell'ordine utile.
 *
 * Prima i propri (lettura e scrittura): sono quelli che rispondono meglio e
 * che l'utente controlla. Gli indicizzatori si aggiungono solo per i kind che
 * tengono davvero.
 */
export function relayPerLeggere(kind: number, config: RelayConfigurati): string[] {
  const elenco = [
    ...config.readRelays,
    ...config.writeRelays,
    ...(KIND_DA_INDICIZZATORI.includes(kind) ? config.indexerRelays : []),
  ]
  return [...new Set(elenco)]
}
