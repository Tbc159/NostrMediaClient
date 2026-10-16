<script setup lang="ts">
/**
 * The Media section's two tabs.
 *
 * One entry in the menu and three jobs inside: putting a file on the network,
 * preparing audio, publishing an episode. Whoever arrives at one finds the
 * others a click away, without going back to the menu.
 */
const schede = [
  { to: '/media', etichetta: 'Carica su Blossom', esatto: false },
  { to: '/media/audio', etichetta: 'Audio', esatto: true },
  { to: '/media/podcast', etichetta: 'Podcast', esatto: true },
]

const rotta = useRoute()
// «Upload to Blossom» covers /media and /media/nuovo; the others only themselves.
const attiva = (s: (typeof schede)[number]) =>
  s.esatto
    ? rotta.path === s.to
    : rotta.path.startsWith('/media') && !schede.some((x) => x.esatto && x.to === rotta.path)
</script>

<template>
  <nav aria-label="Sezione Media" class="flex gap-1 border-b">
    <NuxtLink
      v-for="s in schede"
      :key="s.to"
      :to="s.to"
      class="-mb-px border-b-2 px-3 py-2 text-sm"
      :class="
        attiva(s)
          ? 'border-[var(--accento)] font-medium'
          : 'border-transparent text-[var(--testo-tenue)] hover:text-[var(--testo)]'
      "
      :aria-current="attiva(s) ? 'page' : undefined"
    >
      {{ s.etichetta }}
    </NuxtLink>
  </nav>
</template>
