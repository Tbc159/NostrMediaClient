import { useObservable } from '@vueuse/rxjs'
import type { Observable } from 'rxjs'
import { type Ref, shallowRef } from 'vue'

export interface UseModelOptions<T> {
  /**
   * The value returned until the observable has emitted, and in SSR.
   * Without it the consumer receives `undefined` on the first render.
   */
  initial?: T

  /**
   * Forces the subscription on the server side too.
   *
   * As a rule it **should not be used**. See section 4 of the plan: Nostr state
   * lives in the client alone, because Nuxt's SSR payload ends up serialised in
   * the HTML and a singleton created on Node is shared between every request of
   * every user. A subscription opened on the server side would, besides, never
   * be closed by the component's lifecycle.
   */
  subscribeOnServer?: boolean
}

/** True when the code is running on Node and not in a browser. */
const isServer = typeof window === 'undefined'

/**
 * Turns an RxJS observable into a Vue ref.
 *
 * It is the bridge between applesauce, which exposes its EventStore as an
 * observable, and Vue's reactivity: from here on a piece of Nostr data is
 * consumed like any other state in the application.
 *
 * The subscription is tied to the calling component's effect scope and is
 * closed on unmount by `useObservable`.
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

  // In SSR we return an inert ref: no subscription opened, no session state
  // that could end up in the serialised payload.
  if (isServer && !subscribeOnServer) {
    return shallowRef<T | undefined>(initial) as Readonly<Ref<T | undefined>>
  }

  return useObservable<T, T | undefined>(source, {
    initialValue: initial,
  }) as Readonly<Ref<T | undefined>>
}
