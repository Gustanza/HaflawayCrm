<script setup>
/**
 * What happened last time — the answer to "it's overdue, so what do I do about it?"
 *
 * A row that says only "1h overdue" states a fact and withholds the one thing that makes it
 * actionable. "No answer, 3rd attempt" and "We spoke — wants the quote by Friday" are the
 * same colour of overdue and completely different jobs: the first is a WhatsApp, the second
 * is a quote. TODO.md P1 says the timeline is the primary record and everything else is a
 * summary of it; this is that summary, at the only size a table row has room for.
 *
 * Reads the denormalised `lastOutcome`/`lastNote` copy on the lead, NOT the activities
 * subcollection — see logActivity(). Rendering this from the source would cost one query
 * per row (§11.3), which is the reason the information was missing in the first place.
 */
import { computed } from 'vue'
import { outcomeMessageKey } from '@/domain/taxonomies.js'

const props = defineProps({
  lead: { type: Object, required: true },
})

/**
 * Tone follows what the outcome means for the next action, not whether it was pleasant.
 * `wrong_number` is rose because it is the one outcome that makes every future attempt
 * pointless until someone fixes the number — it is a task, not a disappointment.
 */
const TONE = {
  spoke: 'text-emerald-700',
  callback_requested: 'text-emerald-700',
  no_answer: 'text-amber-700',
  busy: 'text-amber-700',
  switched_off: 'text-amber-700',
  wrong_number: 'text-rose-700',
}

const outcome = computed(() => props.lead.lastOutcome ?? null)

/**
 * Unanswered attempts, shown only once there are several.
 *
 * One missed call is noise. Three in a row is the lead telling you something — it is what
 * drives `engagementScore` down and it is the signal that the channel, not the timing, is
 * wrong. Hidden below 2 so the common case stays quiet.
 */
const attempts = computed(() => {
  const n = props.lead.consecutiveNoAnswer
  return Number.isFinite(n) && n >= 2 ? n : null
})

const note = computed(() => props.lead.lastNote || null)

/** Nothing logged yet is its own state, and a useful one: this lead has never been worked. */
const isEmpty = computed(() => !outcome.value && !note.value)
</script>

<template>
  <div v-if="isEmpty" class="text-sm text-slate-400">—</div>

  <div v-else class="min-w-0">
    <p v-if="outcome" class="truncate text-sm font-medium" :class="TONE[outcome] ?? 'text-slate-700'">
      {{ $t(outcomeMessageKey(outcome)) }}
      <span v-if="attempts" class="font-normal opacity-80">
        {{ $t('lastContact.attempts', { count: attempts }) }}
      </span>
    </p>

    <!-- The customer's own words, quoted and dimmed so they never compete with the outcome
         above. `title` carries the full text for the truncated case: a note is at most a
         sentence, and a tooltip is cheaper than a second click into the timeline. -->
    <p v-if="note" class="truncate text-xs text-slate-500" :title="note">
      {{ note }}
    </p>
  </div>
</template>
