<script setup lang="ts">
import { toNpub } from '@nmc/nostr-core'

import { useProfiloProprio } from '~/stores/profiloProprio'

const identita = useIdentity()
const profilo = useProfiloProprio()

// The identity's state lives in localStorage: it must be read in the browser alone.
onMounted(() => identita.ripristina())

const voci = [
  { to: '/', label: 'Eventi' },
  { to: '/scrivi', label: 'Scrivi' },
  { to: '/media', label: 'Media' },
  { to: '/articoli', label: 'Articoli' },
  { to: '/calendario', label: 'Calendario' },
  { to: '/profilo', label: 'Profilo' },
  { to: '/firme', label: 'Firme' },
  { to: '/diagnostica', label: 'Diagnostica' },
  { to: '/impostazioni', label: 'Impostazioni' },
]

const rotta = useRoute()
const attiva = (to: string) => (to === '/' ? rotta.path === '/' : rotta.path.startsWith(to))

/**
 * Switching between the identities saved in this browser.
 *
 * A local key arrives locked: the switch lands on the settings, where its
 * password is asked, instead of leaving a «read only» that is not true.
 */
const erroreCambio = ref<string | null>(null)
const nomeIdentita = (s: { pubkey: string; etichetta?: string }): string =>
  s.pubkey === identita.pubkey && profilo.daProfilo && profilo.nome
    ? profilo.nome
    : (s.etichetta ?? `${toNpub(s.pubkey).slice(0, 12)}…`)

async function cambia(ev: Event): Promise<void> {
  const select = ev.target as HTMLSelectElement
  const scelta = select.value
  erroreCambio.value = null
  try {
    await identita.cambiaIdentita(scelta)
    if (identita.modo === 'locale' && !identita.sbloccato) await navigateTo('/impostazioni')
  } catch (e) {
    erroreCambio.value = e instanceof Error ? e.message : String(e)
    select.value = identita.pubkey ?? ''
  }
}
</script>

<template>
  <div class="min-h-dvh">
    <!-- A direct skip to the content: the first thing whoever navigates by keyboard meets -->
    <a
      href="#contenuto"
      class="superficie sr-only rounded-md border px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
    >
      Vai al contenuto
    </a>

    <header class="superficie sticky top-0 z-40 border-b">
      <div class="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <NuxtLink to="/" class="font-semibold tracking-tight">NostrMediaClient</NuxtLink>

        <nav aria-label="Navigazione principale" class="flex flex-wrap items-center gap-1">
          <NuxtLink
            v-for="v in voci"
            :key="v.to"
            :to="v.to"
            class="rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-[var(--sfondo-alt)]"
            :class="
              attiva(v.to) ? 'font-medium text-[var(--accento)]' : 'text-[var(--testo-tenue)]'
            "
            :aria-current="attiva(v.to) ? 'page' : undefined"
          >
            {{ v.label }}
          </NuxtLink>
        </nav>

        <div class="ml-auto flex items-center gap-2 text-xs">
          <ClientOnly>
            <template v-if="identita.autenticato">
              <BaseBadge :tono="identita.puoFirmare ? 'successo' : 'avviso'">
                {{
                  identita.puoFirmare
                    ? 'può pubblicare'
                    : identita.modo === 'locale'
                      ? 'bloccata'
                      : 'sola lettura'
                }}
              </BaseBadge>
              <!--
                The profile's name, when there is one; the npub stays in the
                title, and as the text when the profile has no name — an
                identity without a kind 0 is an identity all the same.
              -->
              <NuxtLink
                v-if="identita.salvate.length <= 1"
                to="/profilo"
                class="max-w-40 truncate text-[var(--testo-tenue)] hover:underline"
                :title="identita.npub ?? undefined"
              >
                <template v-if="profilo.daProfilo">{{ profilo.nome }}</template>
                <code v-else>{{ identita.npub?.slice(0, 12) }}…</code>
              </NuxtLink>
              <select
                v-if="identita.salvate.length > 1"
                aria-label="Cambia identità"
                title="Cambia identità"
                class="superficie max-w-32 rounded-md border px-1.5 py-1 text-xs"
                :value="identita.pubkey ?? ''"
                @change="cambia"
              >
                <option v-for="s in identita.salvate" :key="s.pubkey" :value="s.pubkey">
                  {{ nomeIdentita(s) }}
                </option>
              </select>
              <span v-if="erroreCambio" role="alert" class="text-[var(--pericolo)]">
                {{ erroreCambio }}
              </span>
            </template>
            <BaseButton v-else to="/impostazioni" size="sm" variant="primario">Accedi</BaseButton>
          </ClientOnly>
        </div>
      </div>
    </header>

    <main id="contenuto" class="mx-auto max-w-4xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
