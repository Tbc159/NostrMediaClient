import type { PiattaformaClient } from '@nmc/nostr-core'

/**
 * Scrivania o telefono, per scegliere quale client esterno aprire.
 *
 * Non si guarda lo user agent, che e' notoriamente inaffidabile e che i
 * browser stanno congelando: si guarda **come si interagisce**. Un dispositivo
 * senza puntatore fine e senza passaggio del mouse e' un touch, e su quello ha
 * senso aprire un'app; una finestra stretta su un portatile resta una
 * scrivania, e aprirci un'app che non c'e' non aiuterebbe nessuno.
 *
 * `matchMedia` e' reattivo: un tablet con tastiera agganciata o staccata
 * cambia risposta, e il pulsante deve seguirlo senza ricaricare la pagina.
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
