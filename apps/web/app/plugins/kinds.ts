import { registerBuiltinKinds } from '@nmc/nostr-core'

/**
 * Registra i kind conosciuti all'avvio.
 *
 * Gira sia lato server sia lato client: il registry e' pura descrizione di
 * formati, non contiene stato di sessione, quindi condividerlo fra richieste
 * SSR non pone i problemi che riguardano invece signer e pool di relay.
 */
export default defineNuxtPlugin(() => {
  registerBuiltinKinds()
})
