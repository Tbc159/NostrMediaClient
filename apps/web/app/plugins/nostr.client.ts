import { createRelayPool, type RelayPool } from '@nmc/nostr-core'

/**
 * Pool di connessioni ai relay, creato una sola volta per sessione del browser.
 *
 * Il suffisso `.client` non e' un dettaglio: e' la regola di sicurezza della
 * sezione 4 del piano. Su Node un pool a livello di modulo sarebbe condiviso
 * fra tutte le richieste SSR di tutti gli utenti, e con lui le eventuali
 * autenticazioni NIP-42 — la sessione di un utente finirebbe in quella di un
 * altro. Qui il pool nasce nel browser, vive quanto la scheda e muore con essa.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const pool = createRelayPool()

  // Chiudere le connessioni allo smontaggio dell'app evita che un hot reload
  // in sviluppo lasci dietro di se' WebSocket orfani verso ogni relay.
  nuxtApp.hook('app:beforeMount', () => {
    window.addEventListener('beforeunload', () => pool.close(), { once: true })
  })

  return {
    provide: { relayPool: pool as RelayPool },
  }
})
