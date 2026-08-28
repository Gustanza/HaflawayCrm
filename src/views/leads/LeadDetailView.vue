<script setup>
/**
 * Lead detail — TODO.md §12 screen 4.
 *
 * P1: the timeline is the primary record, not a footnote. The header is a cached summary
 * of it, so the timeline gets the space and sits above everything optional. An agent
 * opening a lead thirty seconds before dialling needs one thing: what happened last time.
 *
 * The stage control validates against the state machine BEFORE writing, so an illegal move
 * produces a sentence the agent can act on rather than an opaque permission error from the
 * rules (§5.2).
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { collection, doc, orderBy, query, limit } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection, useDoc } from '@/composables/useCollection.js'
import { changeStage } from '@/services/leads.service.js'
import { nextStages, validateTransition, LOSS_REASONS, PARK_REASONS } from '@/domain/stages.js'
import { BUDGET_BANDS } from '@/domain/taxonomies.js'
import { formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { formatMoney, toMinor } from '@/domain/money.js'
import { toDate } from '@/domain/periods.js'
import { priorityScore } from '@/domain/scoring.js'
import { useNow } from '@/composables/useNow.js'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'

const props = defineProps({ id: { type: String, required: true } })

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
// Ticks on its own — see useNow.js. Keeps the printed Priority figure honest if this page
// is left open across a day boundary.
const now = useNow()
const { t, locale } = useI18n()

const { item: lead, loading, loaded } = useDoc(async () => doc(await getDb(), 'leads', props.id))

/**
 * The timeline is paged at the QUERY, not sliced after the fact (§11.3): a lead worked for
 * months can hold hundreds of activities, and reading 500 documents to render 20 is exactly
 * the read-cost mistake that composable exists to prevent. Opening a lead now costs 21 reads
 * instead of a flat 50.
 *
 * Growing `limit` rather than a `startAfter` cursor, deliberately. A cursor would need a
 * second query whose pages are stitched onto a live first page, and `at` is a
 * serverTimestamp — two activities written in the same batch (a stage change and its system
 * entry) can share one, so a value-based cursor could step over an entry. P1 says this
 * timeline IS the record; silently dropping one entry to save a few reads is a bad trade.
 * Re-querying costs `shown + 1` reads on an explicit user action, which happens rarely and
 * is still far cheaper than the 50-read default it replaces.
 *
 * One extra document past the window is the sentinel: if it comes back, there is older
 * history and the UI says so instead of pretending the record ends here.
 */
const TIMELINE_PAGE = 20
const timelineLimit = ref(TIMELINE_PAGE)

const {
  items: timeline,
  loading: loadingTimeline,
  load: reloadTimeline,
} = useCollection(
  async () =>
    query(
      collection(await getDb(), 'leads', props.id, 'activities'),
      orderBy('at', 'desc'),
      limit(timelineLimit.value + 1),
    ),
  { live: true },
)

// Still one live listener: `load()` tears the previous one down before subscribing, so
// widening the window never leaks (§11.3, B23).
const activities = computed(() => timeline.value.slice(0, timelineLimit.value))
const hasOlder = computed(() => timeline.value.length > timelineLimit.value)

function loadOlder() {
  if (loadingTimeline.value) return
  timelineLimit.value += TIMELINE_PAGE
  reloadTimeline()
}

const showLog = ref(false)
const stageOpen = ref(false)
const pendingStage = ref(null)
const lossReason = ref('')
const parkReason = ref('')
const dealValue = ref('')
// §5.3 BEDS: 'qualified' needs budget and decision-maker known. There is no contacts
// subsystem yet (TODO.md), so decisionMakerContactId is captured here as a plain name —
// a real contact reference can replace this input without touching the state machine,
// which only ever checks that the field is non-empty.
const budgetBand = ref('unknown')
const decisionMaker = ref('')

const telLink = computed(() => toTelLink(lead.value?.primaryPhoneNormalized))
const whatsappLink = computed(() =>
  toWhatsAppLink(
    lead.value?.primaryPhoneNormalized,
    t('lead.whatsappGreeting', { name: lead.value?.displayName ?? '' }),
  ),
)

const available = computed(() => (lead.value ? nextStages(lead.value.stage) : []))

/** What the target stage still needs before the move is legal (§5.2, §5.3). */
const extras = computed(() => {
  const stage = pendingStage.value
  if (!stage) return {}
  const out = {}
  if (stage === 'lost' && lossReason.value) out.lossReason = lossReason.value
  if (stage === 'parked' && parkReason.value) out.parkReason = parkReason.value
  if ((stage === 'won' || stage === 'quoted') && dealValue.value) {
    const minor = toMinor(dealValue.value)
    if (minor !== null) out.dealValueMinor = minor
  }
  if (stage === 'qualified' && (budgetBand.value !== 'unknown' || decisionMaker.value.trim())) {
    // A full merged object, not a dotted-path key: validateTransition() reads
    // qualification.budgetBand by walking the nested object, and the Firestore write below
    // must not clobber committeeMeetsOn/interestedProductIds that are already set.
    out.qualification = {
      ...(lead.value?.qualification ?? {}),
      budgetBand: budgetBand.value,
      decisionMakerContactId: decisionMaker.value.trim() || null,
    }
  }
  return out
})

const check = computed(() =>
  pendingStage.value && lead.value
    ? validateTransition({ ...lead.value, ...extras.value }, pendingStage.value)
    : { ok: false, message: '' },
)

function openStage(stage) {
  pendingStage.value = stage
  lossReason.value = ''
  parkReason.value = ''
  dealValue.value = lead.value?.dealValueMinor ? String(lead.value.dealValueMinor / 100) : ''
  budgetBand.value = lead.value?.qualification?.budgetBand ?? 'unknown'
  decisionMaker.value = lead.value?.qualification?.decisionMakerContactId ?? ''
}

async function confirmStage() {
  if (!check.value.ok) return
  const target = pendingStage.value
  try {
    await changeStage({
      lead: lead.value,
      toStage: target,
      user: { uid: auth.uid, displayName: auth.displayName },
      extra: extras.value,
    })
    ui.success(t('detail.stageChanged', { stage: t(`stage.${target}`) }))
    stageOpen.value = false
    pendingStage.value = null
  } catch (error) {
    ui.error(error.message ?? t('errors.write.generic'))
  }
}

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'sw' ? 'sw-TZ' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Dar_es_Salaam',
    }),
)

const when = (value) => {
  const d = toDate(value)
  return d ? dateFormat.value.format(d) : ''
}

const ACTIVITY_ICON = {
  call: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  whatsapp: 'M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z',
  visit: 'M12 21s-7-5.7-7-11a7 7 0 1 1 14 0c0 5.3-7 11-7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  note: 'M4 4h16v12l-4 4H4zM16 20v-4h4',
  stage_change: 'M4 12h16M14 6l6 6-6 6',
  system: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4l3 2',
  assignment: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  payment: 'M2 7h20v10H2zM2 11h20',
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-2xl mx-auto">
    <LoadingRows v-if="loading && !loaded" :rows="3" />

    <div v-else-if="!lead" class="card p-8 text-center">
      <p class="text-sm text-slate-700">{{ $t('detail.notFound') }}</p>
      <RouterLink :to="{ name: 'leads' }" class="btn-primary mt-4">
        {{ $t('nav.leads') }}
      </RouterLink>
    </div>

    <template v-else>
      <!-- Header: identity, the event clock, stage. Nothing else competes. -->
      <header class="card p-4 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-slate-900 break-words">
              {{ lead.displayName || $t('lead.unnamed') }}
            </h1>
            <div class="mt-1">
              <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" />
            </div>
            <a
              v-if="telLink"
              :href="telLink"
              class="mt-1 block text-sm text-brand-700 tabular-nums hover:underline"
            >
              {{ formatPhone(lead.primaryPhoneNormalized) }}
            </a>
          </div>
          <StageBadge :stage="lead.stage" />
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div v-if="lead.dealValueMinor">
            <dt class="text-slate-500">{{ $t('detail.dealValue') }}</dt>
            <dd class="font-medium text-slate-900">
              {{ formatMoney(lead.dealValueMinor, lead.currency) }}
            </dd>
          </div>
          <div v-if="lead.guestCountEstimate">
            <dt class="text-slate-500">{{ $t('detail.guests') }}</dt>
            <dd class="font-medium text-slate-900">{{ lead.guestCountEstimate }}</dd>
          </div>
          <div v-if="lead.nextActionAt">
            <dt class="text-slate-500">{{ $t('detail.nextAction') }}</dt>
            <dd class="font-medium text-slate-900">{{ when(lead.nextActionAt) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ $t('detail.priority') }}</dt>
            <dd class="font-medium text-slate-900 tabular-nums">{{ priorityScore(lead, now) }}</dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2">
          <a v-if="telLink" :href="telLink" class="btn-secondary flex-1 text-sm">
            {{ $t('lead.call') }}
          </a>
          <a
            v-if="whatsappLink"
            :href="whatsappLink"
            target="_blank"
            rel="noopener"
            class="btn-secondary flex-1 text-sm"
          >
            {{ $t('lead.whatsapp') }}
          </a>
          <button type="button" class="btn-primary flex-1 text-sm" @click="showLog = true">
            {{ $t('lead.log') }}
          </button>
        </div>

        <button
          v-if="available.length"
          type="button"
          class="btn-secondary w-full mt-2 text-sm"
          :aria-expanded="stageOpen"
          @click="stageOpen = !stageOpen"
        >
          {{ $t('detail.changeStage') }}
        </button>
      </header>

      <!-- Stage change, validated before it is attempted (§5.2). -->
      <section v-if="stageOpen" class="card p-4 mt-3">
        <h2 class="field-label">{{ $t('detail.moveTo') }}</h2>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="stage in available"
            :key="stage"
            type="button"
            class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                   bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                   data-[on=true]:ring-brand-600"
            style="min-height: var(--spacing-touch)"
            :data-on="pendingStage === stage"
            @click="openStage(stage)"
          >
            {{ $t(`stage.${stage}`) }}
          </button>
        </div>

        <div v-if="pendingStage" class="mt-4 space-y-3">
          <div v-if="pendingStage === 'lost'">
            <label for="loss" class="field-label">{{ $t('detail.lossReason') }}</label>
            <select id="loss" v-model="lossReason" class="field-input">
              <option value="">{{ $t('detail.choose') }}</option>
              <option v-for="r in LOSS_REASONS" :key="r" :value="r">
                {{ $t(`lossReason.${r}`) }}
              </option>
            </select>
          </div>

          <div v-if="pendingStage === 'parked'">
            <label for="park" class="field-label">{{ $t('detail.parkReason') }}</label>
            <select id="park" v-model="parkReason" class="field-input">
              <option value="">{{ $t('detail.choose') }}</option>
              <option v-for="r in PARK_REASONS" :key="r" :value="r">
                {{ $t(`parkReason.${r}`) }}
              </option>
            </select>
          </div>

          <div v-if="pendingStage === 'qualified'" class="space-y-3">
            <div>
              <label for="budget" class="field-label">{{ $t('detail.budgetBand') }}</label>
              <select id="budget" v-model="budgetBand" class="field-input">
                <option v-for="b in BUDGET_BANDS" :key="b" :value="b">
                  {{ $t(`budgetBand.${b}`) }}
                </option>
              </select>
            </div>
            <div>
              <label for="decision-maker" class="field-label">{{ $t('detail.decisionMaker') }}</label>
              <input
                id="decision-maker"
                v-model="decisionMaker"
                type="text"
                class="field-input"
                :placeholder="$t('detail.decisionMakerPlaceholder')"
              />
            </div>
          </div>

          <div v-if="pendingStage === 'won' || pendingStage === 'quoted'">
            <label for="deal" class="field-label">{{ $t('detail.dealValue') }} (TZS)</label>
            <input
              id="deal"
              v-model="dealValue"
              type="text"
              inputmode="numeric"
              class="field-input tabular-nums"
              placeholder="150000"
            />
          </div>

          <p v-if="!check.ok && check.message" class="field-error" role="alert">
            {{ check.message }}
          </p>

          <button type="button" class="btn-primary w-full" :disabled="!check.ok" @click="confirmStage">
            {{ $t('detail.confirmMove', { stage: $t(`stage.${pendingStage}`) }) }}
          </button>
        </div>
      </section>

      <!-- The timeline. P1: this is the record, everything above is a summary of it. -->
      <section class="mt-5" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" class="mb-2 text-sm font-semibold text-slate-800">
          {{ $t('detail.timeline') }}
        </h2>

        <LoadingRows v-if="loadingTimeline && !activities.length" :rows="3" />

        <p v-else-if="!activities.length" class="card p-6 text-center text-sm text-slate-500">
          {{ $t('detail.noActivity') }}
        </p>

        <ol v-else class="space-y-2">
          <li
            v-for="a in activities"
            :key="a.id"
            class="card p-3 flex gap-3"
            :class="a.isVoided ? 'opacity-50' : ''"
          >
            <span
              class="mt-0.5 size-8 shrink-0 rounded-full bg-slate-100 text-slate-600
                     grid place-items-center"
              aria-hidden="true"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ACTIVITY_ICON[a.type] ?? ACTIVITY_ICON.note" />
              </svg>
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-medium text-slate-900">
                  {{ a.outcome ? $t(`activity.outcome.${a.outcome === 'no_answer' ? 'noAnswer'
                     : a.outcome === 'switched_off' ? 'switchedOff'
                     : a.outcome === 'wrong_number' ? 'wrongNumber'
                     : a.outcome === 'callback_requested' ? 'callbackRequested'
                     : a.outcome}`) : $t(`activityType.${a.type}`) }}
                </span>
                <span class="text-xs text-slate-400 shrink-0 tabular-nums">{{ when(a.at) }}</span>
              </div>
              <p v-if="a.body" class="mt-0.5 text-sm text-slate-600 break-words">{{ a.body }}</p>
              <p class="mt-0.5 text-xs text-slate-400">{{ a.byUserName || a.byUserId }}</p>
              <p v-if="a.isVoided" class="mt-1 text-xs text-rose-600">
                {{ $t('detail.voided', { reason: a.voidReason }) }}
              </p>
            </div>
          </li>
        </ol>

        <!-- P1: the timeline IS the record, so it must never end ambiguously. Either there
             is older history and we offer it, or there is none and we say that outright —
             the user never has to guess whether they are seeing everything. -->
        <div v-if="activities.length" class="mt-2">
          <button
            v-if="hasOlder"
            type="button"
            class="btn-secondary w-full text-sm"
            :disabled="loadingTimeline"
            @click="loadOlder"
          >
            {{ loadingTimeline ? $t('common.loading') : $t('list.loadOlder') }}
          </button>
          <p v-else class="py-2 text-center text-xs text-slate-400" role="status">
            {{ $t('list.noMore') }}
          </p>
        </div>
      </section>

      <LogActivityDialog v-if="showLog" :lead="lead" @close="showLog = false" />
    </template>
  </div>
</template>
