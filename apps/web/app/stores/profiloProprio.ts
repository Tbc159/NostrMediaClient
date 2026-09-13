import { displayName, getKindDefinition, type Profile } from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * Il profilo (kind 0) dell'identita' attiva, per il nome nel menu.
 *
 * Si legge una volta per chiave e si tiene in memoria: il menu e' su ogni
 * pagina, e interrogare i relay a ogni cambio di rotta per un nome che non
 * cambia sarebbe rumore. Se il profilo non c'e' o non arriva, resta l'npub
 * accorciato — che e' comunque un'identita' leggibile, non un errore.
 */
export const useProfiloProprio = defineStore('profilo-proprio', () => {
  const identita = useIdentity()
  const profilo = ref<Profile | null>(null)
  const perChiave = ref<string | null>(null)
  const inCorso = ref(false)

  const nome = computed(() => {
    if (!identita.pubkey) return null
    return displayName(profilo.value ?? undefined, identita.pubkey)
  })

  /** Vero se il nome mostrato viene dal profilo e non dalla chiave. */
  const daProfilo = computed(() =>
    Boolean(profilo.value?.display_name?.trim() || profilo.value?.name?.trim()),
  )

  async function carica(): Promise<void> {
    const pubkey = identita.pubkey
    if (!pubkey || inCorso.value || perChiave.value === pubkey) return
    inCorso.value = true
    try {
      const esistente = useEventoEsistente()
      const trovato = await esistente.perCoordinata(0)
      const definizione = getKindDefinition(0)
      profilo.value = trovato && definizione ? (definizione.parse(trovato) as Profile) : null
      perChiave.value = pubkey
    } catch {
      profilo.value = null
    } finally {
      inCorso.value = false
    }
  }

  // Cambiando identita' — accesso, uscita — il nome segue la chiave nuova.
  watch(
    () => identita.pubkey,
    (pubkey) => {
      if (pubkey !== perChiave.value) {
        profilo.value = null
        perChiave.value = null
      }
      if (pubkey) void carica()
    },
    { immediate: true },
  )

  return { nome, daProfilo, profilo, carica }
})
