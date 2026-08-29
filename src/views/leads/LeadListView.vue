<script setup>
/**
 * Lead list — TODO.md §12 screen 3.
 *
 * Filtering is client-side over a bounded page, not server-side, and that is deliberate:
 * every extra `where()` needs its own composite index, and at 60–100 leads per agent the
 * whole working set fits in one query. When a single agent's open pipeline stops fitting
 * in 100 documents, move the stage filter server-side and add the index — not before.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { useNow } from '@/composables/useNow.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { leadsQuery } from '@/services/queries.js'
import { priorityScore, followUpBucket, urgencyBand } from '@/domain/scoring.js'
import { BOARD_ORDER } from '@/domain/stages.js'
import { normalizePhone, formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { formatMoney } from '@/domain/money.js'
import { toDate, daysToEvent } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import NextActionCountdown from '@/components/leads/NextActionCountdown.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const { t } = useI18n()

const auth = useAuthStore()

const user = computed(() => ({
  uid: auth.uid,
  role: auth.role,
  orgId: auth.orgId,
  teamId: auth.teamId,
}))

const canSeeOtherOwners = computed(() => auth.can.viewAllLeads || auth.can.viewTeamLeads)

// PAGE_SIZE must match the `max` given to leadsQuery() below — useCollection cannot infer
// it from the query object, and it's what tells hasMore whether a fetch that returned
// exactly this many documents might be hiding more. `order` makes which N documents come
// back deterministic (most-recently-active first) instead of arbitrary Firestore doc-ID
// order — the client-side priorityScore sort below still decides what's shown FIRST among
// whatever has been loaded so far; this only fixes what gets loaded at all.
const LIST_PAGE_SIZE = 100
const { items, loading, loadingMore, loaded, error, load, loadMore, hasMore } = useCollection(
  (after) =>
    leadsQuery(user.value, {
      max: LIST_PAGE_SIZE,
      after,
      order: { field: 'updatedAt', direction: 'desc' },
    }),
  { live: false, pageSize: LIST_PAGE_SIZE },
)

// Resolves ownerId -> display name from the redacted usersPublic mirror (never the full
// user doc — see useUserNames.js). Only fetched at all for roles that can see other
// people's leads; an agent only ever sees their own, so the name is never rendered anyway.
const { nameFor } = useUserNames(() => (canSeeOtherOwners.value ? auth.orgId : null))

// Ticks on its own — see useNow.js. Keeps the sort order honest even on this one-shot list,
// which would otherwise be frozen at whatever priorityScore looked like at load time.
const now = useNow()

const search = ref('')
const stageFilter = ref('')
const ownerFilter = ref('')
const showClosed = ref(false)

/**
 * The follow-up filter — a SECOND, independent dimension from stage.
 *
 * Stage is where the deal has got to; this is when the agent promised to ring back. They
 * answer different questions ("who is nearly closing" vs "who am I late for") and an agent
 * combines them, so they are two rows of chips, not one. Buckets are mutually exclusive,
 * which is what makes the counts on the chips mean anything.
 *
 * '' is no filter. Order is worst-first, matching the work queue (§10.2).
 */
const DUE_FILTERS = ['overdue', 'today', 'upcoming', 'none']
const dueFilter = ref('')

/**
 * The event filter — the THIRD dimension, and the customer's clock rather than the agent's.
 *
 * Bands and wording are `urgencyBand`'s and the Upcoming events board's, deliberately: the
 * same question must not acquire two vocabularies. If this row and that screen ever drift
 * apart, the row is wrong.
 *
 * Worth saying plainly, since it was argued at the time: this DOES duplicate what the
 * Upcoming events board already does, and it earns its place only if an agent wants the
 * wedding clock and the follow-up clock narrowed together on one screen, which that board
 * cannot do.
 */
const EVENT_FILTERS = ['critical', 'high', 'medium', 'low', 'unknown', 'passed']
const eventFilter = ref('')

/**
 * Sort order. 'priority' is the product default (§8.7 priorityScore, which weighs the
 * event date, qualification and engagement together). 'nextAction' is the escape hatch for
 * the one question that score deliberately does not answer on its own: what did I promise
 * to do soonest.
 *
 * Two states, not a three-way asc/desc/off cycle — "furthest-out reminder first" is not a
 * question anybody asks, and a third click that silently reverses the list is a worse
 * affordance than one that turns the sort off.
 */
const sortMode = ref('priority')

/** Which column each sort belongs to, so one header can only ever own one mode. */
const SORTABLE = { nextAction: 'nextAction', eventDate: 'eventDate' }

/** Owners actually present in what's loaded so far — only meaningful once names resolve. */
const ownerOptions = computed(() => {
  if (!canSeeOtherOwners.value) return []
  const ids = new Set(items.value.map((l) => l.ownerId).filter(Boolean))
  return [...ids]
    .map((id) => ({ id, name: nameFor(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

/**
 * Sorted ascending, soonest reminder first, so an overdue lead lands above a lead due in
 * an hour. A lead with no reminder sorts LAST whichever way you look at it — it is not
 * "infinitely far away", it simply has no answer to this question, and burying it under
 * the scheduled work is the honest place for it.
 */
function nextActionMs(lead) {
  const at = toDate(lead.nextActionAt)
  return at === null ? Number.POSITIVE_INFINITY : at.getTime()
}

/** The event-date band, in the Upcoming events board's own vocabulary. */
const bandOf = (lead) => urgencyBand(daysToEvent(lead.eventDate, now.value))

/** Same rule for the wedding: a lead with no event date has no answer, so it sorts last. */
function eventMs(lead) {
  const at = toDate(lead.eventDate)
  return at === null ? Number.POSITIVE_INFINITY : at.getTime()
}

function compare(a, b) {
  // NaN-safe throughout: Infinity - Infinity is NaN, which would make the sort
  // non-deterministic across the whole "no date" tail. NaN is falsy, so those fall
  // through to priority — which still ranks them against each other sensibly.
  if (sortMode.value === SORTABLE.nextAction) {
    const diff = nextActionMs(a) - nextActionMs(b)
    if (diff) return diff
  }
  if (sortMode.value === SORTABLE.eventDate) {
    const diff = eventMs(a) - eventMs(b)
    if (diff) return diff
  }
  return priorityScore(b, now.value) - priorityScore(a, now.value)
}

/**
 * Everything the agent asked for, EXCEPT the open/closed rule.
 *
 * Split out from `filtered` so the header can answer a question the list otherwise leaves
 * unanswered: a closed lead is visible on the Pipeline board (which has Won/Lost columns)
 * but silently absent here, and the only clue was a "showing 1 of 2" that never said why.
 * The difference between this set and `filtered` IS that explanation, and it is exact —
 * it counts only leads the OTHER filters already accept, so the offer to reveal them
 * cannot promise rows that would not actually appear.
 */
const matching = computed(() => {
  const term = search.value.trim().toLowerCase()
  // Let an agent paste or type a phone number and find the lead — the most common way
  // they identify someone who has just rung them.
  const asPhone = term ? normalizePhone(term) : null

  return items.value.filter((lead) => {
    if (stageFilter.value && lead.stage !== stageFilter.value) return false
    if (ownerFilter.value && lead.ownerId !== ownerFilter.value) return false
    if (dueFilter.value && followUpBucket(lead.nextActionAt, now.value) !== dueFilter.value) {
      return false
    }
    if (eventFilter.value && bandOf(lead) !== eventFilter.value) return false
    if (!term) return true
    const name = (lead.displayName ?? '').toLowerCase()
    const phone = lead.primaryPhoneNormalized ?? ''
    return (
      name.includes(term) ||
      phone.includes(term.replace(/\D/g, '')) ||
      (asPhone !== null && phone === asPhone)
    )
  })
})

const filtered = computed(() =>
  matching.value.filter((lead) => showClosed.value || lead.leadStatus === 'open').sort(compare),
)

/** How many more rows ticking "Show closed" would actually add. Zero once it is ticked. */
const hiddenClosed = computed(() => matching.value.length - filtered.value.length)

const stageCounts = computed(() => {
  const counts = {}
  for (const lead of items.value) {
    if (!showClosed.value && lead.leadStatus !== 'open') continue
    counts[lead.stage] = (counts[lead.stage] ?? 0) + 1
  }
  return counts
})

const visibleStages = computed(() => BOARD_ORDER.filter((s) => stageCounts.value[s] > 0))

/**
 * Counted over the same base set as `stageCounts` — everything loaded, minus closed leads
 * — and deliberately NOT narrowed by the other filters. A chip has to say how many leads
 * it would show if you pressed it; a count that shrank as you typed in the search box
 * would be answering a different question.
 */
const dueCounts = computed(() => {
  const counts = {}
  for (const lead of items.value) {
    if (!showClosed.value && lead.leadStatus !== 'open') continue
    const bucket = followUpBucket(lead.nextActionAt, now.value)
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  return counts
})

// 'later' has no chip: a reminder three weeks out is not something an agent triages on,
// and a chip nobody presses still costs a row of thumb-height target on a phone.
const visibleDueFilters = computed(() => DUE_FILTERS.filter((b) => dueCounts.value[b] > 0))

/** Same base set and same "hide the empty ones" rule as the other two chip rows. */
const eventCounts = computed(() => {
  const counts = {}
  for (const lead of items.value) {
    if (!showClosed.value && lead.leadStatus !== 'open') continue
    const band = bandOf(lead)
    counts[band] = (counts[band] ?? 0) + 1
  }
  return counts
})

const visibleEventFilters = computed(() =>
  EVENT_FILTERS.filter((b) => eventCounts.value[b] > 0),
)

/** Rose for overdue only. Everything else stays neutral so the one alarm keeps its force. */
const DUE_CHIP_CLASS = {
  overdue:
    'ring-rose-400 text-rose-700 data-[on=true]:bg-rose-600 data-[on=true]:text-white data-[on=true]:ring-rose-600',
  today:
    'ring-slate-400 text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white data-[on=true]:ring-slate-800',
  upcoming:
    'ring-slate-400 text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white data-[on=true]:ring-slate-800',
  none:
    'ring-slate-300 text-slate-500 data-[on=true]:bg-slate-600 data-[on=true]:text-white data-[on=true]:ring-slate-600',
}

/**
 * One chip. Shared by all three filter rows: they sit on the same line now, so any drift
 * in padding or height between them reads as a rendering bug rather than as three groups.
 * Written as complete literals - Tailwind cannot see an interpolated class name.
 */
const CHIP = 'rounded-full bg-white px-3 text-sm font-medium ring-1 ring-inset'

/** The default, for filters that carry no semantic colour of their own. */
const CHIP_NEUTRAL =
  'ring-slate-400 text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white data-[on=true]:ring-slate-800'

const DUE_CHIP_LABEL = {
  overdue: 'leads.dueOverdue',
  today: 'leads.dueToday',
  upcoming: 'leads.dueUpcoming',
  none: 'leads.dueNone',
}

/**
 * The band tokens, which the contrast suite already holds to 4.5:1 as text on white — so
 * white text ON them is the same ratio, and the filled state is safe without a new token.
 *
 * WRITTEN OUT IN FULL, never assembled from a `var(--color-urgent-${band})` template.
 * Tailwind finds classes by scanning source text for complete literals; an interpolated
 * name is invisible to it, so the utility is simply never generated and the chip renders
 * with no fill at all. Verified against the built CSS, not assumed. Same reason
 * EventCountdown.vue spells its BAND_CLASS map out.
 */
const EVENT_CHIP_CLASS = {
  critical:
    'ring-[var(--color-urgent-critical)] text-[var(--color-urgent-critical)] data-[on=true]:bg-[var(--color-urgent-critical)] data-[on=true]:text-white data-[on=true]:ring-[var(--color-urgent-critical)]',
  high:
    'ring-[var(--color-urgent-high)] text-[var(--color-urgent-high)] data-[on=true]:bg-[var(--color-urgent-high)] data-[on=true]:text-white data-[on=true]:ring-[var(--color-urgent-high)]',
  medium:
    'ring-[var(--color-urgent-medium)] text-[var(--color-urgent-medium)] data-[on=true]:bg-[var(--color-urgent-medium)] data-[on=true]:text-white data-[on=true]:ring-[var(--color-urgent-medium)]',
  low:
    'ring-[var(--color-urgent-low)] text-[var(--color-urgent-low)] data-[on=true]:bg-[var(--color-urgent-low)] data-[on=true]:text-white data-[on=true]:ring-[var(--color-urgent-low)]',
  // No date and date-passed are not urgency, so they get no urgency colour.
  unknown:
    'ring-slate-300 text-slate-500 data-[on=true]:bg-slate-600 data-[on=true]:text-white data-[on=true]:ring-slate-600',
  passed:
    'ring-slate-300 text-slate-500 data-[on=true]:bg-slate-600 data-[on=true]:text-white data-[on=true]:ring-slate-600',
}

/** Pressing the active sort header turns it off, back to the priority default. */
function toggleSort(mode) {
  sortMode.value = sortMode.value === mode ? 'priority' : mode
}

function clearFilters() {
  search.value = ''
  stageFilter.value = ''
  dueFilter.value = ''
  eventFilter.value = ''
}

const pager = usePagination(filtered, { pageSize: 25 })

// Any change to the filters must return the user to page 1, or they land on an empty
// page 7 of a 2-page result and conclude there is nothing there.
watch(
  [search, stageFilter, ownerFilter, showClosed, dueFilter, eventFilter, sortMode],
  () => pager.reset(),
)

const logTarget = ref(null)

function isOverdue(lead) {
  const next = toDate(lead.nextActionAt)
  return next !== null && next.getTime() < now.value.getTime()
}

function telLink(lead) {
  return toTelLink(lead.primaryPhoneNormalized || lead.primaryPhone)
}
function whatsappLink(lead) {
  return toWhatsAppLink(
    lead.primaryPhoneNormalized || lead.primaryPhone,
    t('lead.whatsappGreeting', { name: lead.displayName ?? '' }),
  )
}
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.leads')">
      <!-- The count alone was a riddle: a lost lead shows on the Pipeline board but not
           here, and "showing 1 of 2" named the discrepancy without explaining it. Say what
           is missing, and make saying so the way to get it back. Only rendered when
           something really is hidden. -->
      <template #subtitle>
        {{ $t('leads.showing', { shown: filtered.length, total: items.length }) }}
        <template v-if="hiddenClosed">
          ·
          <button
            type="button"
            class="underline underline-offset-2 hover:text-brand-700"
            @click="showClosed = true"
          >
            {{ $t('leads.revealClosed', { count: hiddenClosed }) }}
          </button>
        </template>
      </template>

      <template v-if="auth.can.createLead" #actions>
        <RouterLink :to="{ name: 'lead-new' }" class="btn-primary text-sm">
          + {{ $t('nav.newLead') }}
        </RouterLink>
      </template>

      <!-- Search and the stage chips live in the header so they stay reachable while a
           long list scrolls — they are how you change what the list IS, not part of it. -->
      <template #toolbar>
        <!--
          DENSITY, deliberately.

          This block had grown to six stacked full-width rows - search, three labelled chip
          rows, a checkbox and an owner select - roughly 330px of chrome before the first
          lead. On a phone that is the whole viewport; on a desktop it was stacking narrow
          controls down the left edge while three quarters of the width sat empty.

          So: pair the two text controls on one line, and let the three chip groups flow
          along a single wrapping row. Wide screens get one line of filters, narrow screens
          wrap back to one group per line - which is what they had anyway, and where the
          vertical space was never the thing being wasted.
        -->
        <div class="space-y-2">
          <!-- The owner select was a full-width control holding one short name. -->
          <div class="flex flex-col gap-2 sm:flex-row">
            <div class="flex-1">
              <label for="lead-search" class="sr-only">{{ $t('leads.searchLabel') }}</label>
              <input
                id="lead-search"
                v-model="search"
                type="search"
                class="field-input"
                inputmode="search"
                :placeholder="$t('leads.searchPlaceholder')"
              />
            </div>

            <!-- Only worth showing to a role that sees more than their own leads; an
                 agent's "owner" is always themselves. Filters over what's loaded so far -
                 Load more (below) brings more into view if the person isn't there yet. -->
            <div v-if="canSeeOtherOwners &amp;&amp; ownerOptions.length" class="sm:w-56">
              <label for="lead-owner" class="sr-only">{{ $t('leads.owner') }}</label>
              <select id="lead-owner" v-model="ownerFilter" class="field-input">
                <option value="">{{ $t('leads.allOwners') }}</option>
                <option v-for="o in ownerOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>
          </div>

          <!--
            Three groups, one row. Each keeps its visible label: without one, "This week"
            under Event and "Due this week" under Follow-up are two chips that look like
            they answer the same question, and side by side on a single line that would be
            worse, not better. `gap-x-5` is what separates the groups - wider than the
            `gap-1.5` between chips inside a group, so the grouping survives the wrap.
          -->
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div
              class="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-labelledby="filter-stage-label"
            >
              <span id="filter-stage-label" class="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                {{ $t('leads.filterStage') }}
              </span>
              <button
                type="button"
                :class="[CHIP, CHIP_NEUTRAL]"
                style="min-height: 2.25rem"
                :data-on="stageFilter === ''"
                :aria-pressed="stageFilter === ''"
                @click="stageFilter = ''"
              >
                {{ $t('leads.all') }}
              </button>
              <button
                v-for="stage in visibleStages"
                :key="stage"
                type="button"
                :class="[CHIP, CHIP_NEUTRAL]"
                style="min-height: 2.25rem"
                :data-on="stageFilter === stage"
                :aria-pressed="stageFilter === stage"
                @click="stageFilter = stageFilter === stage ? '' : stage"
              >
                {{ $t(`stage.${stage}`) }}
                <span class="ml-1 opacity-70">{{ stageCounts[stage] }}</span>
              </button>
            </div>

            <!-- No "All" chip here - these toggle off by pressing the active one, and a
                 second "All" beside the stage row's would read as if it reset both. -->
            <div
              v-if="visibleDueFilters.length"
              class="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-labelledby="filter-due-label"
            >
              <span id="filter-due-label" class="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                {{ $t('leads.filterFollowUp') }}
              </span>
              <button
                v-for="bucket in visibleDueFilters"
                :key="bucket"
                type="button"
                :class="[CHIP, DUE_CHIP_CLASS[bucket]]"
                style="min-height: 2.25rem"
                :data-on="dueFilter === bucket"
                :aria-pressed="dueFilter === bucket"
                @click="dueFilter = dueFilter === bucket ? '' : bucket"
              >
                {{ $t(DUE_CHIP_LABEL[bucket]) }}
                <span class="ml-1 opacity-70">{{ dueCounts[bucket] }}</span>
              </button>
            </div>

            <!-- The customer's clock. Same bands and same words as the Upcoming events
                 board, on purpose - see EVENT_FILTERS in the script. -->
            <div
              v-if="visibleEventFilters.length"
              class="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-labelledby="filter-event-label"
            >
              <span id="filter-event-label" class="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                {{ $t('leads.filterEvent') }}
              </span>
              <button
                v-for="band in visibleEventFilters"
                :key="band"
                type="button"
                :class="[CHIP, EVENT_CHIP_CLASS[band]]"
                style="min-height: 2.25rem"
                :data-on="eventFilter === band"
                :aria-pressed="eventFilter === band"
                @click="eventFilter = eventFilter === band ? '' : band"
              >
                {{ $t(`urgency.${band}`) }}
                <span class="ml-1 opacity-70">{{ eventCounts[band] }}</span>
              </button>
            </div>

            <!-- Widens the list rather than narrowing it, so it is not a chip and it sits
                 apart from them - pushed to the far end where there is room for it. -->
            <label class="flex items-center gap-2 text-sm text-slate-600 sm:ml-auto">
              <input v-model="showClosed" type="checkbox" class="size-4 rounded border-slate-400" />
              {{ $t('leads.showClosed') }}
            </label>
          </div>
        </div>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="5" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <EmptyState
      v-else-if="filtered.length === 0 && items.length > 0"
      :title="$t('leads.noMatches')"
      :body="$t('leads.noMatchesBody')"
    >
      <button type="button" class="btn-secondary" @click="clearFilters">
        {{ $t('leads.clearFilters') }}
      </button>
    </EmptyState>

    <EmptyState
      v-else-if="items.length === 0 && loaded"
      :title="$t('leads.none')"
      :body="$t('leads.noneBody')"
    >
      <RouterLink v-if="auth.can.createLead" :to="{ name: 'lead-new' }" class="btn-primary">
        + {{ $t('nav.newLead') }}
      </RouterLink>
    </EmptyState>

    <template v-else>
      <div class="data-table-wrap">
        <table class="data-table min-w-[58rem]">
          <thead>
            <tr>
              <th>{{ $t('leads.name') }}</th>
              <!-- Both clocks sort. `aria-sort` goes on the th, the control is the button
                   inside it — a th is not focusable and cannot carry the click. -->
              <th :aria-sort="sortMode === 'eventDate' ? 'ascending' : 'none'">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 hover:text-slate-900"
                  :title="$t('leads.sortByEvent')"
                  @click="toggleSort('eventDate')"
                >
                  {{ $t('leads.event') }}
                  <svg
                    class="size-3.5"
                    :class="sortMode === 'eventDate' ? 'text-brand-700' : 'text-slate-400'"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  <span class="sr-only">{{ $t('leads.sortByEvent') }}</span>
                </button>
              </th>
              <th :aria-sort="sortMode === 'nextAction' ? 'ascending' : 'none'">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 hover:text-slate-900"
                  :title="$t('leads.sortByNextAction')"
                  @click="toggleSort('nextAction')"
                >
                  {{ $t('leads.nextAction') }}
                  <svg
                    class="size-3.5"
                    :class="sortMode === 'nextAction' ? 'text-brand-700' : 'text-slate-400'"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  <span class="sr-only">{{ $t('leads.sortByNextAction') }}</span>
                </button>
              </th>
              <th>{{ $t('leads.stage') }}</th>
              <th class="text-right">{{ $t('leads.dealValue') }}</th>
              <th v-if="canSeeOtherOwners">{{ $t('leads.owner') }}</th>
              <th>{{ $t('leads.phone') }}</th>
              <th class="text-right">{{ $t('leads.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="lead in pager.items.value"
              :key="lead.id"
              :class="isOverdue(lead) ? 'bg-rose-50/40' : ''"
            >
              <td>
                <RouterLink
                  :to="{ name: 'lead-detail', params: { id: lead.id } }"
                  class="font-semibold text-slate-900 hover:text-brand-700"
                >
                  {{ lead.displayName || $t('lead.unnamed') }}
                </RouterLink>
              </td>
              <td>
                <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" compact />
              </td>
              <td>
                <NextActionCountdown :at="lead.nextActionAt" />
              </td>
              <td><StageBadge :stage="lead.stage" /></td>
              <td class="num">
                {{ lead.dealValueMinor ? formatMoney(lead.dealValueMinor, lead.currency) : '—' }}
              </td>
              <td v-if="canSeeOtherOwners" class="text-slate-600">
                {{ nameFor(lead.ownerId) }}
              </td>
              <td class="text-slate-600 tabular-nums">
                {{ formatPhone(lead.primaryPhoneNormalized || lead.primaryPhone) }}
              </td>
              <td class="text-right">
                <div class="flex items-center justify-end gap-1">
                  <a
                    v-if="telLink(lead)"
                    :href="telLink(lead)"
                    class="icon-btn"
                    :aria-label="`${$t('lead.call')} ${lead.displayName}`"
                  >
                    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
                    </svg>
                  </a>
                  <a
                    v-if="whatsappLink(lead)"
                    :href="whatsappLink(lead)"
                    target="_blank"
                    rel="noopener"
                    class="icon-btn"
                    :aria-label="`${$t('lead.whatsapp')} ${lead.displayName}`"
                  >
                    <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20zm4.4-5.9c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.5 2.7 2.7 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c0-.1-.2-.2-.4-.3z" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    class="icon-btn"
                    :aria-label="`${$t('lead.log')} ${lead.displayName}`"
                    @click="logTarget = lead"
                  >
                    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    <PaginationBar
      :page="pager.page.value"
      :page-count="pager.pageCount.value"
      :from="pager.from.value"
      :to="pager.to.value"
      :total="pager.total.value"
      :per-page="pager.perPage.value"
      :pages="pager.windowFor(2)"
      :sizes="PAGE_SIZES"
      :has-prev="pager.hasPrev.value"
      :has-next="pager.hasNext.value"
      @prev="pager.prev"
      @next="pager.next"
      @go="pager.go"
      @per-page="pager.setPerPage"
    />

    <!-- Only past the last local page, and only when the SERVER might hold more than was
         fetched — distinct from PaginationBar, which pages the already-loaded set. -->
    <div v-if="hasMore &amp;&amp; pager.page.value === pager.pageCount.value" class="mt-4 text-center">
      <button type="button" class="btn-secondary" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? $t('common.loading') : $t('leads.loadMore') }}
      </button>
    </div>
    </template>

    </div>

    <LogActivityDialog v-if="logTarget" :lead="logTarget" @close="logTarget = null" />
  </div>
</template>
