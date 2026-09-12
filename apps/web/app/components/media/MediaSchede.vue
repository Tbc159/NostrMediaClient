<script setup lang="ts">
/**
 * Le due schede della sezione Media.
 *
 * Una voce sola nel menu e due lavori dentro, perche' sono la stessa cosa
 * vista in due momenti: preparare un file e metterlo in rete. Chi arriva
 * dall'una trova l'altra a un clic, senza tornare al menu.
 */
const schede = [
  { to: '/media', etichetta: 'Carica su Blossom', esatto: false },
  { to: '/media/audio', etichetta: 'Audio', esatto: true },
]

const rotta = useRoute()
// «Carica su Blossom» copre /media e /media/nuovo; «Audio» solo se stesso.
const attiva = (s: (typeof schede)[number]) =>
  s.esatto ? rotta.path === s.to : rotta.path.startsWith('/media') && rotta.path !== '/media/audio'
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
