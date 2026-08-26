<script setup lang="ts">
import type { EventTemplate, NostrEvent } from '@nmc/nostr-core'

const props = defineProps<{
  template: EventTemplate | null
  firmato: NostrEvent | null
}>()

const mostrato = computed(() => props.firmato ?? props.template)
const json = computed(() => (mostrato.value ? JSON.stringify(mostrato.value, null, 2) : ''))

const copiato = ref(false)
async function copia(): Promise<void> {
  try {
    await navigator.clipboard.writeText(json.value)
    copiato.value = true
    setTimeout(() => (copiato.value = false), 1500)
  } catch {
    // Clipboard negata dal browser: il JSON resta comunque selezionabile.
  }
}
</script>

<template>
  <div v-if="mostrato" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <BaseBadge :tono="firmato ? 'successo' : 'neutro'">
        {{ firmato ? 'firmato' : 'non firmato' }}
      </BaseBadge>
      <BaseBadge>kind {{ mostrato.kind }}</BaseBadge>
      <BaseBadge>{{ mostrato.tags.length }} tag</BaseBadge>
      <BaseButton size="sm" variant="fantasma" class="ml-auto" @click="copia">
        {{ copiato ? 'copiato' : 'copia JSON' }}
      </BaseButton>
    </div>

    <pre
      class="superficie max-h-96 overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed"
      >{{ json }}</pre>

    <BaseAlert v-if="firmato" tono="info">
      L’evento è firmato e valido. La pubblicazione sui relay arriva con il pool di connessioni: per
      ora puoi copiarlo e inviarlo con un altro strumento.
    </BaseAlert>
  </div>
</template>
