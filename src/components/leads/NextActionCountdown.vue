<script setup>
/**
 * The follow-up clock — when the agent said they would come back to this lead (§10.2).
 *
 * The sibling of EventCountdown.vue, and deliberately NOT the same thing: that one counts
 * down to the customer's wedding, this one counts down to the promise the agent made when
 * they last logged a call ("remind me in 2 hours"). Both belong on a lead list, because an
 * agent triages on both — a wedding in 3 days you have already rung today is not the same
 * work as one in 3 weeks you promised to ring back an hour ago.
 *
 * Overdue renders as a filled pill rather than coloured text. It is the loudest state in
 * §10.2 and it has to survive a cheap LCD in sunlight, where tinted text on white does not.
 * Colour is never the only signal here either: the wording says "overdue" on its own.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { followUpLabel } from '@/domain/scoring.js'
import { toDate, ORG_TIMEZONE } from '@/domain/periods.js'
import { useNow } from '@/composables/useNow.js'

const props = defineProps({
  /** A lead's `nextActionAt` — Firestore Timestamp, Date, ISO string or millis. */
  at: { type: [Object, Date, String, Number], default: null },
})

const { locale } = useI18n()

// Ticks on its own — see useNow.js. Without it a reminder that falls due while the list is
// open keeps rendering "in 1 min" forever, because nothing else on the page changes.
const now = useNow()

const due = computed(() => followUpLabel(props.at, now.value))

/**
 * Always org time, never the viewer's — a manager abroad must read the same "09:00" the
 * agent in Dar es Salaam set (see periods.js).
 */
const timeFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'sw' ? 'sw-TZ' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: ORG_TIMEZONE,
    }),
)

const params = computed(() => {
  if (!due.value) return {}
  const out = {}
  if (due.value.count !== undefined) out.count = due.value.count
  if (due.value.withTime) out.time = timeFormat.value.format(toDate(props.at))
  return out
})

/** Scheduled-but-not-yet-due tones. Overdue is a pill, handled separately below. */
const TONE = {
  today: 'text-[var(--color-urgent-high)] font-semibold',
  upcoming: 'text-[var(--color-urgent-medium)]',
  later: 'text-slate-500',
}
</script>

<template>
  <!-- No reminder set. Deliberately quiet, but never blank: an empty cell reads as a
       rendering bug, a dash reads as "nothing scheduled". -->
  <span v-if="!due" class="text-sm text-slate-400">—</span>

  <span
    v-else-if="due.bucket === 'overdue'"
    class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white"
  >
    {{ $t(`nextAction.${due.key}`, params) }}
  </span>

  <span v-else class="text-sm" :class="TONE[due.bucket]">
    {{ $t(`nextAction.${due.key}`, params) }}
  </span>
</template>
