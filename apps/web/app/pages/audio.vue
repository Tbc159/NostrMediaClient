<script setup lang="ts">
/**
 * The audio lives in the Media section. This redirect lives in the browser,
 * not in a rule of the server's: on GitHub Pages there is no server, and a
 * redirect declared in `routeRules` would stay a dead letter.
 */
onMounted(() => {
  void navigateTo('/media/audio', { replace: true })
})
</script>

<template>
  <p class="text-sm text-[var(--testo-tenue)]">
    L’audio si è spostato:
    <NuxtLink to="/media/audio" class="underline">Media → Audio</NuxtLink>
    .
  </p>
</template>
