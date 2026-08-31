import type { EventTemplate, NostrEvent } from '../kinds/types.js'

/**
 * Firma delegata (NIP-46).
 *
 * Il problema che risolve: su Nostr un evento ha **una** `pubkey` e **una**
 * firma, e non esiste un campo "autore" distinto dal firmatario. Chi vuole che
 * un episodio risulti pubblicato dal podcast, e non da se stesso, non ha
 * alternative: quell'evento va firmato dalla chiave del podcast.
 *
 * NIP-46 separa le due cose senza consegnare la chiave. Chi la possiede tiene
 * un *banco di firma* in ascolto su un relay; chi vuole pubblicare compone
 * l'evento e ne chiede la firma. La chiave non lascia mai il dispositivo di
 * chi la possiede, e ogni richiesta puo' essere respinta.
 */

/** Qualcosa che sa firmare: la chiave locale, l'estensione, un banco remoto. */
export interface Firmatario {
  /** Chiave pubblica dell'identita' che comparira' nell'evento firmato. */
  pubkey(): Promise<string>
  firma(template: EventTemplate): Promise<NostrEvent>
}

/** Una richiesta di firma arrivata al banco, in attesa di giudizio. */
export interface RichiestaFirma {
  /** Chiave pubblica di chi chiede. E' quella della *sessione*, non la sua identita' su Nostr. */
  cliente: string
  kind: number
  template: EventTemplate
}
