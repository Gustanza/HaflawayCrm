<script setup>
/**
 * A measured figure, rendered honestly — TODO.md §8.5.
 *
 * Three rules, all of them there because the alternative misleads:
 *   - null renders as an em dash with a reason, NEVER as 0. A CAC of "0" reads as free.
 *   - the denominator is always visible: `TZS 42,000 (n=7)`.
 *   - fewer than 3 observations is greyed and labelled, because a per-staff CAC from one
 *     won deal is noise, and it WILL be quoted in a performance review otherwise.
 */
import { computed } from 'vue'
import { formatMoney, formatPercent } from '@/domain/money.js'

const props = defineProps({
  value: { type: Number, default: null },
  n: { type: Number, default: null },
  money: { type: Boolean, default: false },
  percent: { type: Boolean, default: false },
  suffix: { type: String, default: '' },
  lowConfidence: { type: Boolean, default: false },
  showN: { type: Boolean, default: true },
})

const display = computed(() => {
  if (props.value === null || props.value === undefined) return '—'
  if (props.money) return formatMoney(props.value, 'TZS', { compact: true })
  if (props.percent) return formatPercent(props.value)
  return `${props.value}${props.suffix}`
})

const isNull = computed(() => props.value === null || props.value === undefined)
</script>

<template>
  <span class="inline-flex items-baseline gap-1.5">
    <span
      class="tabular-nums"
      :class="[
        isNull ? 'text-slate-400' : lowConfidence ? 'text-slate-400' : 'text-slate-900',
        lowConfidence && !isNull ? 'italic' : '',
      ]"
      :title="isNull ? $t('metrics.noData') : lowConfidence ? $t('metrics.lowConfidence') : undefined"
    >
      {{ display }}
    </span>
    <span v-if="showN && n !== null && !isNull" class="text-xs text-slate-400 tabular-nums">
      (n={{ n }})
    </span>
    <span
      v-if="lowConfidence && !isNull"
      class="text-xs text-amber-700"
      :title="$t('metrics.lowConfidence')"
      aria-hidden="true"
    >⚠</span>
  </span>
</template>
