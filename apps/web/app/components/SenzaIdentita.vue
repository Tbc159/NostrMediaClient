<script setup lang="ts">
/** Ripiego mostrato dove servirebbe un'identita' per avere qualcosa da leggere. */
defineProps<{ cosa: string }>()
</script>

<template>
  <BaseCard>
    <div class="flex flex-col items-center gap-3 py-6 text-center">
      <p class="text-sm text-[var(--testo-tenue)]">
        Questa sezione mostra
        <strong>{{ cosa }}</strong>
        che hai pubblicato tu. Serve un’identità per sapere quali sono.
      </p>
      <BaseButton to="/impostazioni" variant="primario">Accedi</BaseButton>
    </div>
  </BaseCard>
</template>
