<script setup lang="ts">
/**
 * A slider for a numeric value over a known interval.
 *
 * It is for where a text field would have you choose blind: the slider shows
 * **where the value sits between the ends**, which for a threshold in decibels
 * is the information whoever does not have the scale in their head is missing.
 *
 * The current value stays written beside it, and not in the handle's position
 * alone: whoever reads with a screen reader, or has to report a precise
 * number, cannot deduce it from the drawing.
 */
withDefaults(
  defineProps<{
    id?: string
    min: number
    max: number
    step?: number
    /** The unit shown after the value, for example `dB` or `s`. */
    unita?: string
    /** Labels at the ends, to say what the two extremes mean. */
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
