import { displayName, getKindDefinition, type Profile } from '@nmc/nostr-core'
import { defineStore } from 'pinia'

/**
 * The active identity's profile (kind 0), for the name in the menu.
 *
 * It is read once per key and kept in memory: the menu is on every page, and
 * querying the relays on every change of route for a name that does not change
 * would be noise. When the profile is not there or does not arrive, the
 * shortened npub remains — which is a readable identity all the same, not an
 * error.
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

  /** True when the name shown comes from the profile and not from the key. */
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

  // When the identity changes — logging in, logging out — the name follows the new key.
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
