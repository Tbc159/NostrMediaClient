import { NostrConnectProvider, PrivateKeySigner, type NostrPool } from 'applesauce-signers'

import type { SecretKey } from '../identity/keys.js'
import type { Firmatario, RichiestaFirma } from './types.js'

/**
 * Banco di firma: il lato di NIP-46 che possiede la chiave.
 *
 * Resta in ascolto su un relay, riceve richieste cifrate e risponde con eventi
 * firmati. E' quello che di solito si chiama *bunker*, ed e' normalmente un
 * servizio a se'; qui vive dentro il client, cosi' che tenere aperta questa
 * pagina basti a far firmare il podcast senza affidare la chiave a nessuno.
 *
 * ## Due chiavi, non una
 *
 * NIP-46 distingue la `remote-signer-pubkey` dalla `user-pubkey`, e la
 * distinzione qui e' sostanziale. Il **trasporto** — cifratura NIP-44 delle
 * richieste, indirizzo scritto nell'URI — usa una chiave dedicata; la chiave
 * dell'identita' interviene solo per firmare gli eventi approvati. Ne seguono
 * due proprieta' che valgono la complicazione: il banco funziona anche quando
 * l'identita' vive in un'estensione che non espone NIP-44, e chi rubasse la
 * chiave di trasporto potrebbe impersonare *l'indirizzo* del banco, mai
 * l'identita' che firma.
 *
 * Per lo stesso motivo la chiave di trasporto va conservata: rigenerarla a
 * ogni avvio cambierebbe l'indirizzo, e ogni delega concessa smetterebbe di
 * funzionare.
 *
 * ## Cosa il banco non sa
 *
 * La `pubkey` di chi chiede e' quella della **sessione**, generata dal suo
 * client: non e' la sua identita' su Nostr e non dice chi sia davvero. Un
 * banco non autentica nessuno — autorizza chi possiede l'indirizzo, che
 * contiene un segreto. L'approvazione manuale e' quindi l'unico controllo che
 * conta, e per questo non e' aggirabile qui.
 */

export interface OpzioniBanco {
  /** Pool gia' aperto. Il ciclo di vita resta del chiamante. */
  pool: NostrPool
  /** Relay su cui banco e richiedente si incontrano: devono raggiungerlo entrambi. */
  relays: string[]
  /** Chi firma davvero: la chiave dell'identita' che comparira' negli eventi. */
  identita: Firmatario
  /** Chiave di trasporto, conservata fra le sessioni per non cambiare indirizzo. */
  chiaveTrasporto: SecretKey
  /** Segreto dell'indirizzo `bunker://`: autorizza il primo collegamento. */
  segreto: string
  /**
   * I soli kind che il banco accetta di firmare.
   *
   * Non e' un dettaglio di comodo: senza questo elenco chi ottiene una delega
   * per gli episodi potrebbe far firmare una nota qualsiasi, e la firma
   * varrebbe come quella del titolare. I kind non elencati vengono respinti
   * senza nemmeno disturbare chi approva.
   */
  kindsConsentiti: readonly number[]
  /** Il giudizio umano su ogni richiesta ammissibile. */
  approva(richiesta: RichiestaFirma): Promise<boolean>
  /** Notifica che un richiedente si e' collegato. */
  onCollegato?: (cliente: string) => void
}

export interface Banco {
  /** L'indirizzo da consegnare a chi dovra' chiedere le firme. Contiene il segreto. */
  uri: string
  /** Chiave pubblica di trasporto: l'indirizzo del banco, non l'identita' che firma. */
  trasporto: string
  /** Chi e' collegato adesso, se qualcuno lo e'. */
  cliente(): string | null
  ferma(): Promise<void>
}

/**
 * Apre il banco e resta in ascolto finche' non lo si ferma.
 *
 * Serve **un solo richiedente per volta**: la libreria rifiuta un secondo
 * collegamento finche' il primo e' attivo. Per due collaboratori servono due
 * banchi con chiavi di trasporto distinte — il che ha anche il pregio di poter
 * revocarne uno senza toccare l'altro.
 */
export async function avviaBanco(opzioni: OpzioniBanco): Promise<Banco> {
  if (opzioni.relays.length === 0) {
    throw new Error('Il banco ha bisogno di almeno un relay su cui farsi trovare.')
  }
  if (opzioni.kindsConsentiti.length === 0) {
    throw new Error('Un banco che non consente alcun kind non firmerebbe mai nulla.')
  }

  const trasporto = new PrivateKeySigner(opzioni.chiaveTrasporto)
  const consentiti = new Set(opzioni.kindsConsentiti)

  const provider = new NostrConnectProvider({
    pool: opzioni.pool,
    relays: [...opzioni.relays],
    signer: trasporto,
    bunkerSecret: opzioni.segreto,

    /*
     * L'identita' viene esposta al provider con i soli due metodi che servono.
     * NIP-46 prevede anche `nip04_*` e `nip44_*`, cioe' cifrare e **decifrare**
     * con la chiave del titolare: un richiedente potrebbe farsi aprire le
     * bozze cifrate o i messaggi diretti di chi tiene il banco. Le richieste
     * di cifratura sono respinte poco piu' sotto, ma qui i metodi non
     * esistono proprio — un errore nella politica non basterebbe a esporli.
     */
    upstream: {
      getPublicKey: () => opzioni.identita.pubkey(),
      signEvent: (template) => opzioni.identita.firma(template),
    },

    onSignEvent: async (template, cliente) => {
      if (!consentiti.has(template.kind)) return false
      return opzioni.approva({ cliente, kind: template.kind, template: { ...template } })
    },

    // Cifratura e decifratura con la chiave del titolare: mai, per nessuno.
    onNip04Encrypt: () => false,
    onNip04Decrypt: () => false,
    onNip44Encrypt: () => false,
    onNip44Decrypt: () => false,

    ...(opzioni.onCollegato ? { onClientConnect: opzioni.onCollegato } : {}),
  })

  await provider.start()
  const uri = await provider.getBunkerURI()

  return {
    uri,
    trasporto: await trasporto.getPublicKey(),
    cliente: () => provider.client ?? null,
    ferma: () => provider.stop(),
  }
}
