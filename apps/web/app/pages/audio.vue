<script setup lang="ts">
/**
 * L'audio sta nella sezione Media. Questo rimando vive nel browser, non in
 * una regola del server: su GitHub Pages un server non c'e', e un redirect
 * dichiarato in `routeRules` resterebbe lettera morta.
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
