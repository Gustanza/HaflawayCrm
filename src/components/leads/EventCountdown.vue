<script setup>
/**
 * The event-date clock (TODO.md P2) — the product's signature affordance.
 *
 * Colour is NEVER the only signal: the day count is always spelled out beside it, so it
 * survives sunlight on a cheap LCD and colour-blindness alike (§13, §16).
 */
import { computed } from 'vue'
import { daysToEvent } from '@/domain/periods.js'
import { urgencyBand } from '@/domain/scoring.js'

const props = defineProps({
  eventDate: { type: [Object, Date, String, Number], default: null },
  eventType: { type: String, default: null },
  compact: { type: Boolean, default: false },
})

const days = computed(() => daysToEvent(props.eventDate))
const band = computed(() => urgencyBand(days.value))

const BAND_CLASS = {
  critical: 'text-[var(--color-urgent-critical)] font-semibold',
  high: 'text-[var(--color-urgent-high)] font-semibold',
  medium: 'text-[var(--color-urgent-medium)]',
  low: 'text-[var(--color-urgent-low)]',
  passed: 'text-slate-400',
  unknown: 'text-slate-400',
}
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-sm" :class="BAND_CLASS[band]">
    <span v-if="eventType && !compact" class="text-slate-600">
      {{ $t(`eventType.${eventType}`) }}
    </span>
    <span v-if="eventType && !compact" class="text-slate-300" aria-hidden="true">·</span>
    <span>
      <template v-if="days === null">{{ $t('lead.noEventDate') }}</template>
      <template v-else-if="days < 0">{{ $t('lead.eventPassed') }}</template>
      <template v-else-if="days === 0">{{ $t('lead.eventToday') }}</template>
      <template v-else-if="days === 1">{{ $t('lead.eventTomorrow') }}</template>
      <template v-else>{{ $t('lead.daysToEvent', { count: days }) }}</template>
    </span>
  </span>
</template>
