<script setup lang="ts">
import type { Filtro } from '@nmc/nostr-core'

useHead({ title: 'NostrMediaClient' })

const identita = useIdentity()

type Ambito = 'tutti' | 'miei'
const ambito = ref<Ambito>('tutti')

const LIMITE = 50

/**
 * Filtro del feed.
 *
 * Manca ancora la lista dei follow (kind 3) e la risoluzione outbox (NIP-65):
 * finche' non ci sono, "tutti" significa *quello che passa dai relay
 * configurati*, non l'intera rete. Dirlo in UI evita di far credere a una
 * copertura che non c'e'.
 */
function filtro(): Filtro {
  const base: Filtro = { kinds: [1], limit: LIMITE }
  if (ambito.value === 'miei' && identita.pubkey) return { ...base, authors: [identita.pubkey] }
  return base
}

const feed = useTimeline(filtro)

watch(ambito, () => feed.carica())
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold tracking-tight">Feed</h1>
      <div class="flex items-center gap-2">
        <BaseButton
          size="sm"
          :variant="ambito === 'tutti' ? 'primario' : 'fantasma'"
          @click="ambito = 'tutti'"
        >
          Dai relay
        </BaseButton>
        <ClientOnly>
          <BaseButton
            v-if="identita.autenticato"
            size="sm"
            :variant="ambito === 'miei' ? 'primario' : 'fantasma'"
            @click="ambito = 'miei'"
          >
            Le mie note
          </BaseButton>
        </ClientOnly>
        <BaseButton
          size="sm"
          variant="fantasma"
          :loading="feed.caricamento.value"
          @click="feed.carica()"
        >
          Aggiorna
        </BaseButton>
      </div>
    </div>

    <ClientOnly>
      <BaseAlert v-if="!identita.autenticato" tono="info">
        Stai leggendo senza identità.
        <NuxtLink to="/impostazioni" class="underline">Accedi</NuxtLink>
        per pubblicare.
      </BaseAlert>
    </ClientOnly>

    <BaseAlert v-if="feed.errore.value" tono="pericolo">{{ feed.errore.value }}</BaseAlert>

    <ClientOnly>
      <div v-if="feed.caricamento.value && !feed.eventi.value.length" class="flex flex-col gap-3">
        <div v-for="n in 3" :key="n" class="superficie h-24 animate-pulse rounded-xl border" />
      </div>

      <BaseCard v-else-if="!feed.eventi.value.length">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <p class="text-sm text-[var(--testo-tenue)]">
            <template v-if="feed.ultimaLettura.value">
              I relay configurati non hanno restituito note.
              <template v-if="ambito === 'miei'">Non ne hai ancora pubblicate da qui.</template>
              <template v-else>
                Verifica dalla diagnostica che rispondano, oppure cambia relay dalle impostazioni.
              </template>
            </template>
            <template v-else>Lettura dai relay in corso…</template>
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <BaseButton to="/scrivi" variant="primario">Scrivi una nota</BaseButton>
            <BaseButton to="/diagnostica" variant="fantasma">Verifica gli endpoint</BaseButton>
          </div>
        </div>
      </BaseCard>

      <div v-else class="flex flex-col gap-3">
        <EventKindRenderer v-for="e in feed.eventi.value" :key="e.id" :evento="e" />
        <p class="text-center text-xs text-[var(--testo-tenue)]">
          {{ feed.eventi.value.length }} note da {{ feed.destinazioni.value.length }} relay
          <template v-if="feed.eventi.value.length >= LIMITE">
            — è il tetto richiesto ai relay, non tutto quello che esiste.
          </template>
        </p>
      </div>
    </ClientOnly>
  </div>
</template>
