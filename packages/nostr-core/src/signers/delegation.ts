import { NostrConnectSigner, type NostrPool } from 'applesauce-signers'

import type { EventTemplate, NostrEvent } from '../kinds/types.js'
import { plainEventTemplate } from '../identity/keys.js'
import type { Firmatario } from './types.js'

/**
 * Delegated signing: the side of NIP-46 that asks, without holding the key.
 *
 * Whoever connects composes the event as always and, when it is time to sign,
 * sends it to the desk instead of to their own key. The event that comes back
 * carries the holder's `pubkey`: in the eyes of anyone who reads it, it was
 * published by them, and the contribution of whoever prepared it does not
 * appear.
 */

export interface OpzioniDelega {
  /** An already open pool. Its lifecycle stays with the caller. */
  pool: NostrPool
  /** The `bunker://` address received from whoever holds the key. It is for the first connection. */
  uri?: string
  /** An already authorized session, from `Delega.sessione()`, to avoid repeating the pairing. */
  sessione?: string
  /**
   * Who is expected to sign, in hexadecimal.
   *
   * It is the check that makes it safe to identify a delegation by an npub. A
   * `bunker://` address does not say **who** will sign: it carries the desk's
   * transport key, which under NIP-46 may be different from the identity. Only
   * after connecting can you ask `get_public_key` and see whether it answers
   * what the user expected. Without this comparison, a wrong address — or a
   * substituted one — would have an identity other than the chosen one sign,
   * and nobody would notice.
   */
  autoreAtteso?: string
  /** The kinds permission is asked for, declared when connecting. */
  kinds: readonly number[]
}

export interface Delega extends Firmatario {
  /** The identity that will really sign, verified when connecting. */
  autore: string
  /**
   * The session to keep in order to reconnect without repeating the pairing.
   *
   * **It contains the session's private key.** It is nobody's identity and it
   * signs nothing on its own: it only authorizes *asking* the desk, which
   * remains free to refuse. Whoever obtained it could, though, present
   * themselves at the desk in your place, so it is to be treated as a
   * credential.
   */
  sessione(): string
  scollega(): Promise<void>
}

/** Connects to a signing desk and checks that the expected identity answers. */
export async function collegaDelega(opzioni: OpzioniDelega): Promise<Delega> {
  const permessi = NostrConnectSigner.buildSigningPermissions([...opzioni.kinds])

  let signer: NostrConnectSigner
  if (opzioni.sessione) {
    signer = await NostrConnectSigner.fromNbunksec(opzioni.sessione, {
      pool: opzioni.pool,
      permissions: permessi,
    })
  } else if (opzioni.uri) {
    signer = await NostrConnectSigner.fromBunkerURI(opzioni.uri, {
      pool: opzioni.pool,
      permissions: permessi,
    })
  } else {
    throw new Error('Serve un indirizzo bunker:// oppure una sessione gia’ autorizzata.')
  }

  let autore: string
  try {
    autore = await signer.getPublicKey()
  } catch (e) {
    await signer.close().catch(() => {})
    throw new Error(`Il banco non ha dichiarato quale identita’ firma: ${messaggio(e)}`)
  }

  if (opzioni.autoreAtteso && autore !== opzioni.autoreAtteso) {
    // We stop here instead of adapting: signing with an identity other than
    // the chosen one is exactly how this function would fail without anyone
    // noticing.
    await signer.close().catch(() => {})
    throw new Error(
      'Il banco firma con un’identita’ diversa da quella che hai indicato. ' +
        'L’indirizzo non corrisponde all’npub: non lo uso.',
    )
  }

  return {
    autore,
    pubkey: () => Promise.resolve(autore),
    // Flattened before leaving: the template comes from a reactive interface
    // and ends up in `JSON.stringify`, which on Vue's proxies behaves less
    // predictably than it seems.
    firma: (template: EventTemplate): Promise<NostrEvent> =>
      signer.signEvent(plainEventTemplate(template)),
    sessione: () => signer.getNbunksec(),
    scollega: () => signer.close(),
  }
}

function messaggio(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Reads a `bunker://` address without connecting, to validate it in a form. */
export function leggiIndirizzoBanco(uri: string): { trasporto: string; relays: string[] } {
  const letto = NostrConnectSigner.parseBunkerURI(uri.trim())
  if (letto.relays.length === 0) {
    throw new Error('L’indirizzo non indica alcun relay: il banco non sarebbe raggiungibile.')
  }
  return { trasporto: letto.remote, relays: letto.relays }
}
