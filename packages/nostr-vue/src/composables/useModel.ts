import { useObservable } from '@vueuse/rxjs'
import type { Observable } from 'rxjs'
import { type Ref, shallowRef } from 'vue'

export interface UseModelOptions<T> {
  /**
   * Valore restituito finche' l'observable non ha emesso, e in SSR.
   * Senza, il consumatore riceve `undefined` al primo render.
   */
  initial?: T

  /**
   * Forza la sottoscrizione anche lato server.
   *
   * Di norma **non va usato**. Vedi la sezione 4 del piano: lo stato Nostr
   * vive solo nel client, perche' il payload SSR di Nuxt finisce serializzato
   * nell'HTML e un singleton creato su Node e' condiviso fra tutte le
   * richieste di tutti gli utenti. Una sottoscrizione aperta lato server
   * inoltre non verrebbe mai chiusa dal ciclo di vita del componente.
   */
  subscribeOnServer?: boolean
}

/** Vero quando il codice sta girando su Node e non in un browser. */
const isServer = typeof window === 'undefined'

/**
 * Converte un observable RxJS in un ref Vue.
 *
 * E' il ponte fra applesauce, che espone il proprio EventStore come
 * observable, e la reattivita' di Vue: da qui in poi un dato Nostr si consuma
 * come qualunque altro stato dell'applicazione.
 *
 * La sottoscrizione e' legata allo scope effetti del componente chiamante e
 * viene chiusa allo smontaggio da `useObservable`.
 *
 * @example
 * ```ts
 * const profile = useModel(eventStore.model(ProfileModel, pubkey))
 * ```
 */
export function useModel<T>(
  source: Observable<T>,
  options: UseModelOptions<T> = {},
): Readonly<Ref<T | undefined>> {
  const { initial, subscribeOnServer = false } = options

  // In SSR restituiamo un ref inerte: nessuna sottoscrizione aperta, nessuno
  // stato di sessione che possa finire nel payload serializzato.
  if (isServer && !subscribeOnServer) {
    return shallowRef<T | undefined>(initial) as Readonly<Ref<T | undefined>>
  }

  return useObservable<T, T | undefined>(source, {
    initialValue: initial,
  }) as Readonly<Ref<T | undefined>>
}
