<script setup>
/**
 * The month grid — what is on the table, month by month.
 *
 * The Pipeline answers "where is everything right now". This answers the same question with
 * a calendar underneath it, because in an events business those are not the same question:
 * a December wedding still sitting in `new` in November is an emergency, and the identical
 * lead for a June wedding is routine. Same stage, same card, completely different urgency —
 * and only the month tells you which.
 *
 * TWO MONTHS, AND THEY ARE NOT INTERCHANGEABLE (§8.8: cohort ≠ period)
 *
 *   'event'   — the month the wedding happens. A delivery and capacity calendar: what is
 *               booked, and how much of it is still unconverted. The default, because it is
 *               what "what do I have on the table" means to someone running events.
 *   'created' — the month the lead arrived. A marketing cohort: is intake converting.
 *
 * Same grid, one different date field. Mixing them up produces a number that looks
 * plausible and answers neither question, which is exactly what §8.8 warns about.
 *
 * ACCURACY OVER CONVENIENCE
 *
 * Every other list screen loads a bounded page and sorts it client-side; that is fine when
 * the page IS the answer. Here the numbers are the answer, so the query is a range over the
 * whole visible window and the cap is reported honestly when it is hit. A count that
 * silently undercounts is worse than no count.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { useNow } from '@/composables/useNow.js'
import { leadsInDateRangeQuery, undatedLeadsQuery } from '@/services/queries.js'
import { BOARD_ORDER, TERMINAL_STAGES } from '@/domain/stages.js'
import { monthKey, upcomingMonthKeys, recentMonthKeys, monthSpanBounds } from '@/domain/periods.js'
import { formatMoney } from '@/domain/money.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()
const { locale } = useI18n()
const now = useNow()

const user = computed(() => ({
  uid: auth.uid,
  role: auth.role,
  orgId: auth.orgId,
  teamId: auth.teamId,
}))

/* ------------------------------------------------------------------ window */

/** Which clock the grid is built on. See the note at the top — these are two questions. */
const mode = ref('event')

/**
 * Twelve months either way. Forwards for the event calendar, because booked work is ahead
 * of you; backwards for intake, because leads you have already captured are behind you.
 * Offset shifts the window without changing its size.
 */
const WINDOW_MONTHS = 12
const offset = ref(0)

const windowStart = computed(() => {
  const d = new Date(now.value)
  d.setMonth(d.getMonth() + offset.value * WINDOW_MONTHS)
  return d
})

const months = computed(() =>
  mode.value === 'event'
    ? upcomingMonthKeys(WINDOW_MONTHS, windowStart.value)
    : recentMonthKeys(WINDOW_MONTHS, windowStart.value),
)

const dateField = computed(() => (mode.value === 'event' ? 'eventDate' : 'createdAt'))

const MAX_ROWS = 500

const { items, loading, loaded, error, load } = useCollection(async () => {
  const bounds = monthSpanBounds(months.value)
  return leadsInDateRangeQuery(user.value, {
    field: dateField.value,
    start: bounds.start,
    end: bounds.end,
    max: MAX_ROWS,
  })
})

// Changing the window or the clock changes the QUERY, not just the presentation — the
// range bounds are baked into it, so it has to be re-issued rather than re-filtered.
watch([mode, offset], () => {
  selected.value = null
  load()
})

/** Leads with no event date. Only meaningful on the event calendar. */
const { items: undated, load: loadUndated } = useCollection(async () =>
  undatedLeadsQuery(user.value, { max: 100 }),
)

/* -------------------------------------------------------------------- grid */

/**
 * Which stages get a column.
 *
 * Only the ones actually present in the window: eleven columns of which eight read zero is
 * a grid you have to search rather than read. Lost and Disqualified are hidden by default —
 * "on the table" is work you still have, and a lost lead is not — but Won is kept, because
 * a booked wedding is the most on-the-table thing there is.
 */
const showClosed = ref(false)

const visible = computed(() =>
  showClosed.value
    ? items.value
    : items.value.filter((l) => !['lost', 'disqualified'].includes(l.stage)),
)

/**
 * One pass to bucket every lead into month × stage, rather than a filter per cell.
 * A 12 × 11 grid is 132 cells; re-scanning the whole array for each is the same mistake
 * PipelineView documents in its column grouping.
 */
const grid = computed(() => {
  const cells = new Map()
  const rowTotals = new Map()
  const colTotals = new Map()
  const rowValue = new Map()

  for (const lead of visible.value) {
    const key = monthKey(lead[dateField.value])
    if (!key) continue
    const cellKey = `${key}|${lead.stage}`
    cells.set(cellKey, (cells.get(cellKey) ?? 0) + 1)
    rowTotals.set(key, (rowTotals.get(key) ?? 0) + 1)
    colTotals.set(lead.stage, (colTotals.get(lead.stage) ?? 0) + 1)
    if (Number.isInteger(lead.dealValueMinor)) {
      rowValue.set(key, (rowValue.get(key) ?? 0) + lead.dealValueMinor)
    }
  }
  return { cells, rowTotals, colTotals, rowValue }
})

const stages = computed(() => BOARD_ORDER.filter((s) => grid.value.colTotals.get(s) > 0))

const countAt = (month, stage) => grid.value.cells.get(`${month}|${stage}`) ?? 0

const total = computed(() => visible.value.length)
const cappedOut = computed(() => items.value.length >= MAX_ROWS)

/**
 * Firestore reports a missing composite index as `failed-precondition`. It is not a
 * transient failure and retrying will never clear it, so it must not be dressed up as one.
 */
const needsIndex = computed(() => error.value?.code === 'failed-precondition')

/** Month labels in the viewer's language, always in org time. */
const monthLabel = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value === 'sw' ? 'sw-TZ' : 'en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Dar_es_Salaam',
  })
  return (key) => {
    const [y, m] = key.split('-').map(Number)
    return fmt.format(new Date(Date.UTC(y, m - 1, 15)))
  }
})

/** The current month, so "now" is findable in a grid of twelve. */
const thisMonth = computed(() => monthKey(now.value))

/* ------------------------------------------------------------------- drill */

/**
 * A count nobody can open is trivia. Selecting a cell lists exactly the leads behind it,
 * which is also the only way to check the grid is telling the truth.
 */
const selected = ref(null)

function selectCell(month, stage) {
  if (!countAt(month, stage)) return
  const same = selected.value?.month === month && selected.value?.stage === stage
  selected.value = same ? null : { month, stage }
}

const selectedLeads = computed(() => {
  if (!selected.value) return []
  const { month, stage } = selected.value
  return visible.value
    .filter((l) => l.stage === stage && monthKey(l[dateField.value]) === month)
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
})
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.months')">
      <template #subtitle>
        {{ $t(`months.subtitle.${mode}`, { count: total }) }}
        <span v-if="cappedOut" class="text-amber-600">· {{ $t('queue.mayBeMore') }}</span>
      </template>

      <template #toolbar>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <!-- The two questions, named. A silent toggle between them would produce numbers
               that look plausible and answer neither (§8.8). -->
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="months-mode-label">
            <span id="months-mode-label" class="shrink-0 text-xs font-medium uppercase tracking-[0.06em] text-slate-500">
              {{ $t('months.groupBy') }}
            </span>
            <button
              v-for="m in ['event', 'created']"
              :key="m"
              type="button"
              class="rounded-full bg-white px-3 text-sm font-medium ring-1 ring-inset ring-slate-400
                     text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white
                     data-[on=true]:ring-slate-800"
              style="min-height: 2.25rem"
              :data-on="mode === m"
              :aria-pressed="mode === m"
              @click="mode = m"
            >
              {{ $t(`months.mode.${m}`) }}
            </button>
          </div>

          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input v-model="showClosed" type="checkbox" class="size-4 rounded border-slate-400" />
            {{ $t('months.showLost') }}
          </label>

          <div class="flex items-center gap-1 sm:ml-auto">
            <button type="button" class="icon-btn" :aria-label="$t('months.earlier')" @click="offset--">
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              v-if="offset !== 0"
              type="button"
              class="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              @click="offset = 0"
            >
              {{ $t('months.today') }}
            </button>
            <button type="button" class="icon-btn" :aria-label="$t('months.later')" @click="offset++">
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">
      <LoadingRows v-if="loading && !loaded" :rows="6" />

      <!--
        This screen is the one most likely to fail for a reason retrying cannot fix.
        It is the only view whose query combines an equality with a RANGE, so it is the only
        one that needs a composite index of its own — and a missing index fails every time,
        identically, while "Could not load. Check your connection" sends the reader off to
        look at their wifi. Name the actual cause when Firestore gives it to us.
      -->
      <div v-else-if="error" class="card p-6 text-center">
        <p class="text-sm text-slate-700">
          {{ needsIndex ? $t('months.needsIndex') : $t('errors.loadFailed') }}
        </p>
        <p v-if="needsIndex" class="mt-2 text-xs text-slate-500">
          {{ $t('months.needsIndexHelp') }}
        </p>
        <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
      </div>

      <EmptyState
        v-else-if="!stages.length"
        :title="$t('months.none')"
        :body="$t('months.noneBody')"
      />

      <template v-else>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ $t('months.month') }}</th>
                <th v-for="stage in stages" :key="stage" class="text-center">
                  {{ $t(`stage.${stage}`) }}
                </th>
                <th class="text-right">{{ $t('months.total') }}</th>
                <th v-if="auth.can.viewCosts" class="text-right">{{ $t('leads.dealValue') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in months" :key="m" :class="m === thisMonth ? 'bg-brand-50/50' : ''">
                <td class="whitespace-nowrap font-semibold text-slate-900">
                  {{ monthLabel(m) }}
                  <span v-if="m === thisMonth" class="ml-1 text-xs font-normal text-brand-700">
                    {{ $t('months.current') }}
                  </span>
                </td>

                <!-- A zero is rendered as a dash. A grid of noughts reads as data; a grid
                     of dashes reads as "nothing here", which is what it means. -->
                <td v-for="stage in stages" :key="stage" class="text-center">
                  <button
                    v-if="countAt(m, stage)"
                    type="button"
                    class="min-w-8 rounded-md px-2 py-1 text-sm font-semibold tabular-nums
                           text-slate-900 hover:bg-slate-100
                           data-[on=true]:bg-brand-600 data-[on=true]:text-white"
                    :data-on="selected?.month === m && selected?.stage === stage"
                    @click="selectCell(m, stage)"
                  >
                    {{ countAt(m, stage) }}
                  </button>
                  <span v-else class="text-slate-300">—</span>
                </td>

                <td class="num font-semibold">{{ grid.rowTotals.get(m) ?? 0 }}</td>
                <td v-if="auth.can.viewCosts" class="num">
                  {{ grid.rowValue.get(m) ? formatMoney(grid.rowValue.get(m), 'TZS', { compact: true }) : '—' }}
                </td>
              </tr>

              <!-- Undated leads belong to no month. Hiding them would make this grid's
                   totals disagree with every other screen, and a missing event date is the
                   most consequential gap in the data (P2). -->
              <tr v-if="mode === 'event' && undated.length" class="bg-amber-50/50">
                <td class="whitespace-nowrap font-semibold text-amber-800">
                  {{ $t('months.noDate') }}
                </td>
                <td :colspan="stages.length" class="text-xs text-amber-700">
                  {{ $t('months.noDateHelp') }}
                </td>
                <td class="num font-semibold text-amber-800">{{ undated.length }}</td>
                <td v-if="auth.can.viewCosts" />
              </tr>
            </tbody>
          </table>
        </div>

        <!-- A count nobody can open is trivia. -->
        <section v-if="selected" class="mt-4" aria-live="polite">
          <h2 class="mb-2 text-sm font-semibold text-slate-800">
            {{ monthLabel(selected.month) }} · {{ $t(`stage.${selected.stage}`) }}
            <span class="font-normal text-slate-500">({{ selectedLeads.length }})</span>
          </h2>
          <ul class="space-y-2">
            <li v-for="lead in selectedLeads" :key="lead.id" class="card flex items-center gap-3 p-3">
              <RouterLink
                :to="{ name: 'lead-detail', params: { id: lead.id } }"
                class="min-w-0 flex-1 truncate font-semibold text-slate-900 hover:text-brand-700"
              >
                {{ lead.displayName || $t('lead.unnamed') }}
              </RouterLink>
              <EventCountdown :event-date="lead.eventDate" compact />
              <StageBadge :stage="lead.stage" />
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
