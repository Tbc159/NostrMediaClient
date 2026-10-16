import { registerBuiltinKinds } from '@nmc/nostr-core'

/**
 * Registers the known kinds at start-up.
 *
 * It runs on the server side as well as the client side: the registry is pure
 * description of formats, it holds no session state, so sharing it between SSR
 * requests does not raise the problems that affect signers and relay pools.
 */
export default defineNuxtPlugin(() => {
  registerBuiltinKinds()
})
