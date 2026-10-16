import type { PiattaformaClient } from '@nmc/nostr-core'

/**
 * A desk or a phone, for choosing which external client to open.
 *
 * The user agent is not consulted, being notoriously unreliable and in the
 * process of being frozen by the browsers: what is consulted is **how you
 * interact**. A device without a fine pointer and without hover is a touch
 * device, and opening an app makes sense on one of those; a narrow window on a
 * laptop is still a desk, and opening an app that is not there would help
 * nobody.
 *
 * `matchMedia` is reactive: a tablet with its keyboard attached or detached
 * changes the answer, and the button has to follow without reloading the page.
 */
export function useDispositivo() {
  const piattaforma = ref<PiattaformaClient>('desktop')

  function calcola(): void {
    if (!import.meta.client || typeof window.matchMedia !== 'function') return
    const puntatoreGrossolano = window.matchMedia('(pointer: coarse)').matches
    const senzaHover = window.matchMedia('(hover: none)').matches
    piattaforma.value = puntatoreGrossolano && senzaHover ? 'app' : 'desktop'
  }

  onMounted(() => {
    calcola()

    const query = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(hover: none)')]
    for (const q of query) q.addEventListener('change', calcola)
    onBeforeUnmount(() => {
      for (const q of query) q.removeEventListener('change', calcola)
    })
  })

  const suTelefono = computed(() => piattaforma.value === 'app')

  return { piattaforma, suTelefono, calcola }
}
