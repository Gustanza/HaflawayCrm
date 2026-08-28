<script setup>
/**
 * Log what happened, and say when to try again.
 *
 * TODO.md P7: ≤3 taps. Outcome → snooze → done. Everything else is optional, and the note
 * field is deliberately last and unfocused, because typing on a phone at a committee
 * meeting is the slowest thing an agent can be asked to do.
 *
 * The two chips that matter most are the ones nothing else in the category gets right:
 *   "Hapatikani"  (no answer)  — the unreachable case this system exists for
 *   "Baada ya kikao" (after the committee meeting) — §10.1 committee_wait
 *
 * P8: the write is optimistic and never awaited. The dialog closes immediately, offline or
 * not, and the pending count reports what is still in flight.
 */
import { ref, computed, onMounted, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { logActivity, setNextAction } from '@/services/leads.service.js'

const props = defineProps({ lead: { type: Object, required: true } })
const emit = defineEmits(['close', 'logged'])

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const panel = useTemplateRef('panel')

/** Call outcomes, stolen wholesale from Close.com (§3) because they are the right set. */
const OUTCOMES = [
  { value: 'spoke', key: 'activity.outcome.spoke', tone: 'good' },
  { value: 'no_answer', key: 'activity.outcome.noAnswer', tone: 'warn' },
  { value: 'switched_off', key: 'activity.outcome.switchedOff', tone: 'warn' },
  { value: 'busy', key: 'activity.outcome.busy', tone: 'warn' },
  { value: 'callback_requested', key: 'activity.outcome.callbackRequested', tone: 'good' },
  { value: 'wrong_number', key: 'activity.outcome.wrongNumber', tone: 'bad' },
]

/**
 * How this interaction happened. Defaults to 'call' and stays a single optional tap, not a
 * required step — P7's ≤3-tap flow (outcome → snooze → save) still holds for the common
 * case. Without this every logged activity was recorded and displayed as "Call" regardless
 * of what actually happened (WhatsApp, SMS, an in-person visit), corrupting the timeline
 * P1 calls "the primary record, not a footnote." Limited to the channels an activity TYPE
 * icon already exists for (see ACTIVITY_ICON in LeadDetailView.vue) — facebook/instagram/
 * email are first-touch ATTRIBUTION channels, not things you log a follow-up call as.
 */
const CHANNEL_OPTIONS = ['call', 'whatsapp', 'sms', 'visit']

/** "Remind me…" — the literal user request, one tap from the lead (§10.2). */
const SNOOZES = [
  { hours: 2, key: 'snooze.twoHours' },
  { tomorrow9: true, key: 'snooze.tomorrow' },
  { days: 3, key: 'snooze.threeDays' },
  { committee: true, key: 'snooze.afterCommittee' },
  { days: 7, key: 'snooze.oneWeek' },
]

const outcome = ref(null)
// Tracked by INDEX, not by the SNOOZES object itself: assigning an object to a ref's
// `.value` makes Vue wrap it in a reactive Proxy (toReactive()), so `snooze.value` would
// never again be === the plain object it was assigned from — every button's `data-on`
// check silently evaluated false, and nothing ever appeared selected, even though the
// underlying choice (read via property access, which a Proxy forwards fine) still worked.
// An index is a primitive; refs never wrap primitives, so identity comparison is safe.
// `snoozeIndex` is null (nothing chosen), a number (one of SNOOZES), or the literal string
// 'custom' — a real customer does not always fit one of five fixed slots, so this is the
// escape hatch: pick any date and time instead of the nearest preset.
const snoozeIndex = ref(null)
const customDateTime = ref('')

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in the viewer's OWN local time, not UTC. */
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Floor for the picker — a follow-up cannot be reminded for a time already past. */
const minDateTime = toLocalInputValue(new Date())

const snooze = computed(() => {
  if (snoozeIndex.value === 'custom') {
    // `new Date("YYYY-MM-DDTHH:mm")` with no offset/Z is parsed in LOCAL time by spec —
    // exactly what a `datetime-local` input's value represents.
    return customDateTime.value ? { custom: true, at: new Date(customDateTime.value) } : null
  }
  return snoozeIndex.value !== null ? SNOOZES[snoozeIndex.value] : null
})
const note = ref('')
const channel = ref('call')
const saving = ref(false)

const TONE = {
  good: 'ring-emerald-300 data-[on=true]:bg-emerald-600 data-[on=true]:text-white',
  warn: 'ring-amber-300 data-[on=true]:bg-amber-600 data-[on=true]:text-white',
  bad: 'ring-rose-300 data-[on=true]:bg-rose-600 data-[on=true]:text-white',
}

// Previously hidden for 'spoke' on the assumption a successful call never needs a
// follow-up — wrong in practice (e.g. "confirmed details, remind me to send the quote").
// A reminder is optional for every outcome, "spoke" included; just reveal it once there is
// an outcome to attach it to.
const canSnooze = computed(() => outcome.value !== null)
const canSave = computed(() => outcome.value !== null)

function nextActionDate(choice) {
  if (!choice) return null
  if (choice.custom) return choice.at
  const now = new Date()
  if (choice.hours) return new Date(now.getTime() + choice.hours * 3600 * 1000)
  if (choice.days) return new Date(now.getTime() + choice.days * 24 * 3600 * 1000)
  if (choice.tomorrow9) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d
  }
  if (choice.committee) {
    // §10.1 committee_wait: the day after the committee meets, or a week out if we do not
    // know when that is — a committee that has not been asked is itself the next action.
    const meets = props.lead?.qualification?.committeeMeetsOn
    const base = meets ? new Date(meets.seconds ? meets.seconds * 1000 : meets) : null
    if (base) return new Date(base.getTime() + 24 * 3600 * 1000)
    return new Date(now.getTime() + 7 * 24 * 3600 * 1000)
  }
  return null
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true

  const user = { uid: auth.uid, displayName: auth.displayName, orgId: auth.orgId }
  const nextAt = nextActionDate(snooze.value)

  // Fire-and-forget: a Firestore write does not settle offline, and P8 forbids blocking
  // the agent on it. The local cache already has the change.
  ui.trackWrite(
    logActivity({
      leadId: props.lead.id,
      user,
      activity: {
        type: channel.value,
        channel: channel.value,
        outcome: outcome.value,
        body: note.value.trim(),
      },
    }),
  )

  if (nextAt) {
    ui.trackWrite(
      setNextAction({ leadId: props.lead.id, user, at: nextAt, type: channel.value }),
    )
  }

  ui.success(t('activity.saved'))
  emit('logged', { outcome: outcome.value, nextAt })
  emit('close')
}

onMounted(async () => {
  await nextTick()
  panel.value?.focus()
})

function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
    <div class="absolute inset-0 bg-slate-900/50" aria-hidden="true" @click="emit('close')" />

    <div
      ref="panel"
      class="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl
             max-h-[90dvh] overflow-y-auto focus:outline-none"
      style="padding-bottom: max(1rem, env(safe-area-inset-bottom))"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="$t('activity.title')"
      @keydown="onKeydown"
    >
      <header class="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-slate-200">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-semibold text-slate-900 truncate">{{ lead.displayName }}</h2>
            <p class="text-xs text-slate-500">{{ $t('activity.title') }}</p>
          </div>
          <button
            type="button"
            class="btn-ghost px-3 shrink-0"
            :aria-label="$t('common.close')"
            @click="emit('close')"
          >
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      <div class="p-4 space-y-5">
        <!-- Optional: how it happened. Defaults to "call" so this never costs a tap unless
             the agent actually needs to change it. -->
        <fieldset>
          <legend class="field-label">
            {{ $t('activity.channel') }}
            <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in CHANNEL_OPTIONS"
              :key="option"
              type="button"
              class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                     bg-white text-slate-700 data-[on=true]:bg-brand-600
                     data-[on=true]:text-white data-[on=true]:ring-brand-600"
              style="min-height: var(--spacing-touch)"
              :data-on="channel === option"
              :aria-pressed="channel === option"
              @click="channel = option"
            >
              {{ $t(`activityType.${option}`) }}
            </button>
          </div>
        </fieldset>

        <!-- Tap 1: what happened -->
        <fieldset>
          <legend class="field-label">{{ $t('activity.whatHappened') }}</legend>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="option in OUTCOMES"
              :key="option.value"
              type="button"
              class="rounded-lg px-3 text-sm font-medium ring-1 ring-inset transition-colors
                     bg-white text-slate-700"
              :class="TONE[option.tone]"
              style="min-height: var(--spacing-touch)"
              :data-on="outcome === option.value"
              :aria-pressed="outcome === option.value"
              @click="outcome = option.value"
            >
              {{ $t(option.key) }}
            </button>
          </div>
        </fieldset>

        <!-- Tap 2: when to try again. Optional for every outcome, "We spoke" included —
             a successful call can still need a follow-up. -->
        <fieldset v-if="canSnooze">
          <legend class="field-label">
            {{ $t('activity.remindMe') }}
            <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(option, i) in SNOOZES"
              :key="i"
              type="button"
              class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                     bg-white text-slate-700 data-[on=true]:bg-brand-600
                     data-[on=true]:text-white data-[on=true]:ring-brand-600"
              style="min-height: var(--spacing-touch)"
              :data-on="snoozeIndex === i"
              :aria-pressed="snoozeIndex === i"
              @click="snoozeIndex = i"
            >
              {{ $t(option.key) }}
            </button>
            <!-- Not every follow-up fits one of the five fixed slots above. -->
            <button
              type="button"
              class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                     bg-white text-slate-700 data-[on=true]:bg-brand-600
                     data-[on=true]:text-white data-[on=true]:ring-brand-600"
              style="min-height: var(--spacing-touch)"
              :data-on="snoozeIndex === 'custom'"
              :aria-pressed="snoozeIndex === 'custom'"
              @click="snoozeIndex = 'custom'"
            >
              {{ $t('snooze.custom') }}
            </button>
          </div>

          <div v-if="snoozeIndex === 'custom'" class="mt-3">
            <label for="custom-remind-at" class="field-label">{{ $t('snooze.customLabel') }}</label>
            <input
              id="custom-remind-at"
              v-model="customDateTime"
              type="datetime-local"
              class="field-input"
              :min="minDateTime"
            />
          </div>
        </fieldset>

        <!-- Optional, and last: typing is the slowest thing we can ask for. -->
        <div>
          <label for="activity-note" class="field-label">
            {{ $t('activity.note') }}
            <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
          </label>
          <textarea
            id="activity-note"
            v-model="note"
            rows="2"
            class="field-input py-2.5 resize-none"
            :placeholder="$t('activity.notePlaceholder')"
          />
        </div>
      </div>

      <!-- Tap 3: save -->
      <div class="sticky bottom-0 bg-white px-4 py-3 border-t border-slate-200">
        <button type="button" class="btn-primary w-full" :disabled="!canSave" @click="save">
          {{ $t('activity.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
