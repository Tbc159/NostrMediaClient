<script setup lang="ts">
const identita = useIdentity()

// Lo stato dell'identita' vive in localStorage: va riletto solo nel browser.
onMounted(() => identita.ripristina())

const voci = [
  { to: '/', label: 'Feed' },
  { to: '/scrivi', label: 'Scrivi' },
  { to: '/calendario', label: 'Calendario' },
  { to: '/diagnostica', label: 'Diagnostica' },
  { to: '/impostazioni', label: 'Impostazioni' },
]

const rotta = useRoute()
const attiva = (to: string) => (to === '/' ? rotta.path === '/' : rotta.path.startsWith(to))
</script>

<template>
  <div class="min-h-dvh">
    <!-- Salto diretto al contenuto: la prima cosa che incontra chi naviga da tastiera -->
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
                {{ identita.puoFirmare ? 'può pubblicare' : 'sola lettura' }}
              </BaseBadge>
              <code class="text-[var(--testo-tenue)]">{{ identita.npub?.slice(0, 12) }}…</code>
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
