import { ErroreServizio } from '../services/http.js'
import type { MediaProdotto, ServizioAudio, StatoLavoro } from './types.js'

/**
 * Waiting for an asynchronous job, with progress reported to whoever is
 * watching.
 *
 * The interval and the deadline are injectable because tests must not really
 * wait: without that, exercising the «timed out» branch would cost minutes on
 * every run and would end up not being exercised at all.
 */

export interface OpzioniAttesa {
  /** How often to ask for the state. */
  intervalloMs?: number
  /** Past this much time we stop waiting. */
  scadenzaMs?: number
  /** Called on every round, to show that something is moving. */
  onStato?: (stato: StatoLavoro, trascorsoMs: number) => void
  /** To interrupt the wait from outside, without stopping the job on the service. */
  segnale?: AbortSignal
  /** Injectable in tests, where the clock must not really advance. */
  attendi?: (ms: number) => Promise<void>
  adesso?: () => number
}

const riposo = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Waits for a job to finish and returns the media it produced.
 *
 * @throws if the job fails, if time runs out, or if it ends «complete»
 *         without saying what it produced — an outcome to treat as an error:
 *         carrying on with an invented reference would give a 400 further
 *         along, far from the cause.
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
    // The messages stay in Italian: they end up in front of whoever uses the
    // client, and the interface is Italian. They will be translated with it.
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
        `L’elaborazione non è riuscita: ${stato.errore ?? 'motivo non riportato'}.`,
        null,
      )
    }

    if (trascorso + intervallo > scadenza) {
      // The job stays in progress on the service: here we only stop waiting
      // for it, and the message does not promise it has been cancelled.
      throw new ErroreServizio(
        `Il lavoro non è finito entro ${Math.round(scadenza / 1000)}s. ` +
          'Può essere ancora in corso sul servizio.',
        null,
      )
    }

    await attendi(intervallo)
  }
}
