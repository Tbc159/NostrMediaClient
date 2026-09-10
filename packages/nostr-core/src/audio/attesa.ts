import { ErroreServizio } from '../servizi/http.js'
import type { MediaProdotto, ServizioAudio, StatoLavoro } from './tipi.js'

/**
 * Attesa di un lavoro asincrono, con l'avanzamento riportato a chi guarda.
 *
 * Intervallo e scadenza sono iniettabili perche' i test non devono aspettare
 * davvero: senza, provare il ramo «scaduto» costerebbe minuti a ogni giro e
 * finirebbe per non essere provato affatto.
 */

export interface OpzioniAttesa {
  /** Ogni quanto richiedere lo stato. */
  intervalloMs?: number
  /** Oltre questo tempo si smette di aspettare. */
  scadenzaMs?: number
  /** Chiamata a ogni giro, per mostrare che qualcosa si muove. */
  onStato?: (stato: StatoLavoro, trascorsoMs: number) => void
  /** Per interrompere l'attesa da fuori, senza fermare il lavoro sul servizio. */
  segnale?: AbortSignal
  /** Iniettabile nei test, dove l'orologio non deve scorrere davvero. */
  attendi?: (ms: number) => Promise<void>
  adesso?: () => number
}

const riposo = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Aspetta che un lavoro finisca e restituisce i media prodotti.
 *
 * @throws se il lavoro fallisce, se scade il tempo, o se finisce «completato»
 *         senza dire cosa ha prodotto — che e' un esito da trattare come
 *         errore: proseguire con un riferimento inventato darebbe un 400 piu'
 *         avanti, lontano dalla causa.
 */
export async function attendiLavoro(
  servizio: ServizioAudio,
  idLavoro: string,
  opzioni: OpzioniAttesa = {},
): Promise<MediaProdotto[]> {
  const intervallo = opzioni.intervalloMs ?? 2000
  const scadenza = opzioni.scadenzaMs ?? 15 * 60 * 1000
  const attendi = opzioni.attendi ?? riposo
  const adesso = opzioni.adesso ?? (() => Date.now())

  const inizio = adesso()

  for (;;) {
    if (opzioni.segnale?.aborted) {
      throw new ErroreServizio('Attesa interrotta.', null)
    }

    const stato = await servizio.stato(idLavoro)
    const trascorso = adesso() - inizio
    opzioni.onStato?.(stato, trascorso)

    if (stato.stato === 'completato') {
      if (!stato.media?.length) {
        throw new ErroreServizio(
          'Il servizio dice di aver finito ma non dice quale file ha prodotto.',
          null,
        )
      }
      return stato.media
    }

    if (stato.stato === 'fallito') {
      throw new ErroreServizio(
        `L’elaborazione non e’ riuscita: ${stato.errore ?? 'motivo non riportato'}.`,
        null,
      )
    }

    if (trascorso + intervallo > scadenza) {
      // Il lavoro resta in corso sul servizio: qui si smette solo di
      // aspettarlo, e il messaggio non promette che sia stato annullato.
      throw new ErroreServizio(
        `Il lavoro non e’ finito entro ${Math.round(scadenza / 1000)}s. ` +
          'Puo’ essere ancora in corso sul servizio.',
        null,
      )
    }

    await attendi(intervallo)
  }
}
