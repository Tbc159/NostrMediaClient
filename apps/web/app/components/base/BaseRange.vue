<script setup lang="ts">
/**
 * Cursore per un valore numerico su un intervallo noto.
 *
 * Serve dove un campo di testo farebbe scegliere alla cieca: il cursore mostra
 * **dove sta il valore rispetto agli estremi**, che per una soglia in decibel
 * e' l'informazione che manca a chi non ha in testa la scala.
 *
 * Il valore corrente resta scritto accanto, e non solo nella posizione della
 * maniglia: chi legge con uno screen reader, o chi deve riferire un numero
 * preciso, non puo' dedurlo dal disegno.
 */
withDefaults(
  defineProps<{
    id?: string
    min: number
    max: number
    step?: number
    /** Unita' mostrata dopo il valore, per esempio `dB` o `s`. */
    unita?: string
    /** Etichette agli estremi, per dire cosa significano i due capi. */
    estremoMin?: string
    estremoMax?: string
    describedBy?: string
    disabled?: boolean
  }>(),
  {
    step: 1,
    id: undefined,
    unita: undefined,
    estremoMin: undefined,
    estremoMax: undefined,
    describedBy: undefined,
  },
)

const modello = defineModel<number>({ default: 0 })
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-3">
      <input
        :id="id"
        v-model.number="modello"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :aria-describedby="describedBy"
        :disabled="disabled"
        class="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--sfondo-alt)] accent-[var(--accento)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <output
        class="min-w-16 shrink-0 text-right font-mono text-sm tabular-nums"
        :class="disabled && 'opacity-50'"
      >
        {{ modello }}{{ unita }}
      </output>
    </div>
    <div
      v-if="estremoMin || estremoMax"
      class="flex justify-between text-xs text-[var(--testo-tenue)]"
      :class="disabled && 'opacity-50'"
    >
      <span>{{ estremoMin }}</span>
      <span>{{ estremoMax }}</span>
    </div>
  </div>
</template>
