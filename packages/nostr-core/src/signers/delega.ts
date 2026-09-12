import { NostrConnectSigner, type NostrPool } from 'applesauce-signers'

import type { EventTemplate, NostrEvent } from '../kinds/types.js'
import { plainEventTemplate } from '../identity/keys.js'
import type { Firmatario } from './types.js'

/**
 * Delega di firma: il lato di NIP-46 che chiede, senza possedere la chiave.
 *
 * Chi si collega compone l'evento come sempre e, al momento della firma, lo
 * manda al banco invece che alla propria chiave. L'evento che torna porta la
 * `pubkey` del titolare: agli occhi di chiunque lo legga e' stato pubblicato
 * da lui, e il contributo di chi lo ha preparato non compare.
 */

export interface OpzioniDelega {
  /** Pool gia' aperto. Il ciclo di vita resta del chiamante. */
  pool: NostrPool
  /** Indirizzo `bunker://` ricevuto da chi possiede la chiave. Serve al primo collegamento. */
  uri?: string
  /** Sessione gia' autorizzata, da `Delega.sessione()`, per non ripetere l'abbinamento. */
  sessione?: string
  /**
   * Chi ci si aspetta che firmi, in esadecimale.
   *
   * E' il controllo che rende sicuro identificare una delega con un npub. Un
   * indirizzo `bunker://` non dice **chi** firmera': porta la chiave di
   * trasporto del banco, che per NIP-46 puo' essere diversa dall'identita'.
   * Solo dopo il collegamento si puo' chiedere `get_public_key` e vedere se
   * risponde quello che l'utente si aspettava. Senza questo confronto, un
   * indirizzo sbagliato — o sostituito — farebbe firmare un'identita' diversa
   * da quella scelta, e nessuno se ne accorgerebbe.
   */
  autoreAtteso?: string
  /** I kind per cui si chiede il permesso, dichiarati al collegamento. */
  kinds: readonly number[]
}

export interface Delega extends Firmatario {
  /** L'identita' che firmera' davvero, verificata al collegamento. */
  autore: string
  /**
   * La sessione da conservare per ricollegarsi senza ripetere l'abbinamento.
   *
   * **Contiene la chiave privata della sessione.** Non e' l'identita' di
   * nessuno e non firma nulla da sola: autorizza soltanto a *chiedere* al
   * banco, che resta libero di rifiutare. Chi la ottenesse potrebbe pero'
   * presentarsi al banco al posto tuo, quindi va trattata come una credenziale.
   */
  sessione(): string
  scollega(): Promise<void>
}

/** Si collega a un banco di firma e verifica che risponda l'identita' attesa. */
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
    // Ci si ferma qui invece di adattarsi: firmare con un'identita' diversa da
    // quella scelta e' esattamente il modo in cui questa funzione fallirebbe
    // senza che nessuno lo noti.
    await signer.close().catch(() => {})
    throw new Error(
      'Il banco firma con un’identita’ diversa da quella che hai indicato. ' +
        'L’indirizzo non corrisponde all’npub: non lo uso.',
    )
  }

  return {
    autore,
    pubkey: () => Promise.resolve(autore),
    // Appiattito prima di partire: il template arriva da un'interfaccia
    // reattiva e finisce in `JSON.stringify`, che sui proxy di Vue si comporta
    // in modo meno prevedibile di quanto sembri.
    firma: (template: EventTemplate): Promise<NostrEvent> =>
      signer.signEvent(plainEventTemplate(template)),
    sessione: () => signer.getNbunksec(),
    scollega: () => signer.close(),
  }
}

function messaggio(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Legge un indirizzo `bunker://` senza collegarsi, per validarlo in un form. */
export function leggiIndirizzoBanco(uri: string): { trasporto: string; relays: string[] } {
  const letto = NostrConnectSigner.parseBunkerURI(uri.trim())
  if (letto.relays.length === 0) {
    throw new Error('L’indirizzo non indica alcun relay: il banco non sarebbe raggiungibile.')
  }
  return { trasporto: letto.remote, relays: letto.relays }
}
