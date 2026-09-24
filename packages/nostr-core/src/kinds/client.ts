import type { EventTemplate } from './types.js'

/**
 * Il tag `client`: chi ha scritto l'evento.
 *
 * NIP-89 prevede `["client", "<nome>"]` su un evento pubblicato, e i client
 * lo scrivono davvero — un evento calendario ricevuto da Plektos porta
 * `["client", "Plektos"]`. Serve a chi legge per capire con cosa e' stato
 * composto, e a chi sviluppa per sapere da dove arriva un evento malformato.
 *
 * **Sovrascrive** quello che trova. Non e' una gentilezza verso l'altro
 * client: se riapriamo un evento di Plektos e lo ripubblichiamo, quell'evento
 * lo ha scritto questo programma, e lasciare il nome di un altro sarebbe
 * falso. Cambiare solo il tag `client` non riscrive la storia — l'evento
 * originale resta sui relay con il suo id, questo e' un evento nuovo.
 *
 * Si usa la forma semplice, senza la coordinata `31990:…` dell'evento
 * handler: non ne pubblichiamo uno, e dichiarare una coordinata inesistente
 * sarebbe peggio che tacere.
 */

/** Il nome con cui questo client si dichiara. Cablato: non e' configurabile. */
export const NOME_CLIENT = 'NostrMediaClient'

/** Nome del tag, per chi deve riconoscerlo senza scriverlo a mano. */
export const TAG_CLIENT = 'client'

/**
 * Lo stesso template con un solo tag `client`, il nostro.
 *
 * Idempotente e senza effetti sull'originale: ne restituisce una copia.
 */
export function conTagClient(template: EventTemplate): EventTemplate {
  return {
    ...template,
    tags: [...template.tags.filter((t) => t[0] !== TAG_CLIENT), [TAG_CLIENT, NOME_CLIENT]],
  }
}
