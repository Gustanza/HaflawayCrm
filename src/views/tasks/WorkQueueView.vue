<script setup>
/**
 * The Work Queue — TODO.md §10.3, the most important screen in the product.
 *
 * Three sections, sorted by priorityScore: Overdue (red), Today, Coming up. This is what
 * an agent looks at all day, so it answers exactly one question — who do I contact next —
 * and nothing else competes for the space.
 *
 * Sorting happens CLIENT-side on priorityScore, deliberately. The score decays with
 * daysToEvent, so a server-side orderBy on a stored value would go stale between nightly
 * recomputes and quietly bury the leads that matter most (P2, §8.7).
 *
 * WHY ONE PAGINATOR PER SECTION, NOT ONE FOR THE SCREEN
 *
 * Overdue is a different KIND of work from Coming up. A single pager would either
 * interleave them or force the reader through 13 overdue leads to reach today's, so each
 * section pages independently and "Overdue, page 2" means something on its own.
 *
 * The paginator is `compact`: the section heading already carries the label and the true
 * total, so it renders controls and a quiet count and nothing else.
 *
 * THE LAYOUT (rewritten)
 *
 * The rows were an eight-column table 56rem wide, which on the deployment screen meant a
 * horizontal scrollbar and a name wrapping onto two lines beside a due pill doing the
 * same. Rows now reflow instead of scrolling — see QueueLeadRow.vue for the arrangement.
 * The counts moved into the header as a row of focus chips, so the same numbers that
 * describe the day also narrow it to one bucket; nothing else on this screen filters.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { useNow } from '@/composables/useNow.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { leadsQuery } from '@/services/queries.js'
import { priorityScore, followUpBucket } from '@/domain/scoring.js'
import { daysToEvent, toDate } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import QueueLeadRow from '@/components/leads/QueueLeadRow.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const { t, locale } = useI18n()

const user = computed(() => ({
  uid: auth.uid,
  role: auth.role,
  orgId: auth.orgId,
  teamId: auth.teamId,
  displayName: auth.displayName,
}))

const canSeeOtherOwners = computed(() => auth.can.viewAllLeads || auth.can.viewTeamLeads)

// Must match `max` below. `order` makes which leads get fetched deterministic (most
// recently active first) rather than arbitrary Firestore doc-ID order; the priorityScore
// sort further down still decides what's shown FIRST among whatever this fetched.
const QUEUE_PAGE_SIZE = 100

// Live: this is the agent's home screen and a completed follow-up must disappear from it
// immediately. One of the few places real-time earns its read cost (§11.3). That is also
// why there is no "Load more" here unlike List/Pipeline — a live query has no stable
// cursor once anything in the collection changes underneath it (useCollection.js's
// loadMore() refuses to run on one) — but `hasMore` is still reported honestly below, so an
// org-wide role that hits the cap is told rather than left to assume this is everyone.
const { items, loading, loaded, error, load, hasMore } = useCollection(
  () =>
    leadsQuery(user.value, {
      leadStatus: 'open',
      max: QUEUE_PAGE_SIZE,
      order: { field: 'updatedAt', direction: 'desc' },
    }),
  { live: true, pageSize: QUEUE_PAGE_SIZE },
)

const { nameFor } = useUserNames(() => (canSeeOtherOwners.value ? auth.orgId : null))

// Ticks on its own — see useNow.js's docstring for why the buckets below would otherwise
// stay silently stale between Firestore writes, on the one screen that can least afford it.
const now = useNow()

/** Sorted by the score the agent should actually act on. */
const ranked = computed(() =>
  [...items.value]
    .map((lead) => ({ lead, score: priorityScore(lead, now.value) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.lead),
)

/**
 * Shared with the lead list, so the two screens can never disagree about what "overdue"
 * means (see followUpBucket in scoring.js).
 *
 * The one local rule: a lead with NO reminder set falls in with "Coming up" here. The
 * domain function reports that as its own 'none' bucket, which is the truthful answer, but
 * this screen has always shown unscheduled leads as work to pick up rather than hiding
 * them, and it is the only screen an agent has. Changing that is a separate decision.
 */
function bucketOf(lead) {
  const bucket = followUpBucket(lead.nextActionAt, now.value)
  return bucket === 'none' ? 'upcoming' : bucket
}

const overdue = computed(() => ranked.value.filter((l) => bucketOf(l) === 'overdue'))
const dueToday = computed(() => ranked.value.filter((l) => bucketOf(l) === 'today'))
const upcoming = computed(() => ranked.value.filter((l) => bucketOf(l) === 'upcoming'))

const nothingToDo = computed(
  () => loaded.value && !overdue.value.length && !dueToday.value.length && !upcoming.value.length,
)

/**
 * The owner's name is rendered only when it can possibly differ between rows.
 *
 * The table used to give every row an OWNER cell, which for the common case — an agent
 * looking at their own queue, or a manager whose screen happens to hold one person's work
 * — printed the same name forty times down the page. A column that never varies carries no
 * information; it just makes every other column narrower.
 */
const showOwner = computed(
  () => canSeeOtherOwners.value && new Set(items.value.map((l) => l.ownerId)).size > 1,
)

/* -------------------------------------------------- progressive disclosure */

/**
 * One paginator per section, not one for the screen.
 *
 * The sections are the point of this view — Overdue is a different KIND of work from
 * Coming up, and a single pager would either interleave them or force the reader to page
 * through 13 overdue leads to reach today's. Each section is independently addressable,
 * so "Overdue, page 2" means something on its own.
 *
 * Page size 10: about a screen and a half of rows on a phone, and well above the real
 * per-agent load, so for the primary user the paginator never appears at all.
 */
const SECTION_PAGE_SIZE = 10

// One flag per section, so revealing Overdue leaves Today and Coming up exactly as the
// agent left them. Never a single shared flag — that would silently re-collapse a
// section the agent had already opened.
const pagers = {
  overdue: usePagination(overdue, { pageSize: SECTION_PAGE_SIZE }),
  today: usePagination(dueToday, { pageSize: SECTION_PAGE_SIZE }),
  upcoming: usePagination(upcoming, { pageSize: SECTION_PAGE_SIZE }),
}

/**
 * Each section's own voice: a dot, a heading, a count pill, and the tint on the card that
 * holds its rows. §10.2 wants Overdue to be the loudest thing on the page, and it is the
 * only section that gets a colour — a screen where three things shout says nothing.
 *
 * `card` tints the rows' container, not just the heading above it. A section heading and
 * the card under it reading as two unrelated objects is what made this screen look
 * assembled rather than designed.
 */
const SECTION_STYLE = {
  overdue: {
    heading: 'text-rose-800',
    dot: 'bg-rose-600',
    badge: 'bg-rose-600 text-white',
    card: 'ring-rose-200',
    chipOff: 'bg-white text-rose-700 ring-rose-300',
    chipOn: 'bg-rose-600 text-white ring-rose-600',
  },
  today: {
    heading: 'text-slate-800',
    dot: 'bg-slate-700',
    badge: 'bg-slate-800 text-white',
    card: 'ring-slate-200',
    chipOff: 'bg-white text-slate-700 ring-slate-300',
    chipOn: 'bg-slate-800 text-white ring-slate-800',
  },
  upcoming: {
    heading: 'text-slate-700',
    dot: 'bg-slate-300',
    badge: 'bg-slate-200 text-slate-700',
    card: 'ring-slate-200',
    chipOff: 'bg-white text-slate-700 ring-slate-300',
    chipOn: 'bg-slate-800 text-white ring-slate-800',
  },
}

function section(id, leads) {
  const pager = pagers[id]
  return {
    id,
    ...SECTION_STYLE[id],
    label: t(`queue.${id}`),
    shown: pager.items.value,
    // `total` is what the badge renders — the length of the whole bucket, never of
    // `shown`. One place in this file where that can go wrong, and this is it.
    total: leads.length,
    pager,
  }
}

// Overdue is deliberately first and loudest (§10.2).
const allSections = computed(() =>
  [
    section('overdue', overdue.value),
    section('today', dueToday.value),
    section('upcoming', upcoming.value),
  ].filter((s) => s.total > 0),
)

/**
 * The focus chips — the counts of the day, doubling as the only filter on the screen.
 *
 * An agent with eleven overdue leads wants the other two sections gone while they clear
 * them; a manager glancing at the screen wants the three numbers without scrolling. Those
 * are the same control, so the header carries totals that are also buttons, rather than a
 * separate stat strip above a separate filter row.
 *
 * 'all' is the default and always present. Empty buckets get no chip, matching the lead
 * list's filter rows — a chip that would show nothing is a target that only disappoints.
 */
const focus = ref('all')

const sections = computed(() =>
  focus.value === 'all'
    ? allSections.value
    : allSections.value.filter((s) => s.id === focus.value),
)

/** A bucket can empty out under a live listener while it is the one being looked at. */
const focusEmpty = computed(() => focus.value !== 'all' && !sections.value.length)

/**
 * Leads scheduled more than 7 days out. Real, open, and deliberately NOT in the three
 * sections — the work queue answers "what should I do now", and next month is not now.
 *
 * But `bucketOf` was producing this bucket and nothing rendered it, while the subtitle
 * counted it. That meant "37 waiting" could sit above sections holding 22, with the other
 * 15 nowhere on the screen. Count it separately and say where it went, rather than either
 * hiding it or padding the sections with work that is not due.
 */
const later = computed(() => ranked.value.filter((lead) => bucketOf(lead) === 'later'))

/** What the three sections actually hold — the number the subtitle should quote. */
const dueCount = computed(
  () => overdue.value.length + dueToday.value.length + upcoming.value.length,
)

/* ------------------------------------------------------------- log activity */

const logTarget = ref(null)
const openLog = (lead) => (logTarget.value = lead)

/** Context-appropriate "Due" text — a bare time in Today, a full date further out. */
const timeFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'sw' ? 'sw-TZ' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Dar_es_Salaam',
    }),
)
const dateTimeFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'sw' ? 'sw-TZ' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Dar_es_Salaam',
    }),
)

function dueLabel(lead, sectionId) {
  const next = toDate(lead.nextActionAt)
  if (!next) return '—'
  if (sectionId === 'overdue') {
    const days = daysToEvent(lead.nextActionAt, now.value)
    const overdueBy = days === null ? null : Math.abs(days)
    return overdueBy ? t('queue.overdueBy', { count: overdueBy }) : t('queue.overdueNow')
  }
  if (sectionId === 'today') return timeFormat.value.format(next)
  return dateTimeFormat.value.format(next)
}

/** Written out in full — Tailwind cannot see a class name assembled at runtime. */
const CHIP =
  'inline-flex items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors'
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.workQueue')">
      <template #subtitle>
        {{ $t('queue.subtitle', { count: dueCount }) }}
        <span v-if="later.length" class="text-slate-400">
          · {{ $t('queue.scheduledLater', { count: later.length }) }}
        </span>
        <!-- Honest about the cap: a live query has no cursor to fetch past it with (see
             the note in the script above), so this can only say so, not fix itself. -->
        <span v-if="hasMore" class="text-amber-600">
          · {{ $t('queue.mayBeMore') }}
        </span>
      </template>
      <template v-if="auth.can.createLead" #actions>
        <RouterLink :to="{ name: 'lead-new' }" class="btn-primary text-sm">
          + {{ $t('nav.newLead') }}
        </RouterLink>
      </template>

      <!--
        The day's shape, as buttons. Lives in the header so it stays put while a long
        Overdue section scrolls — it is how you change what the screen IS, not part of it.

        Hidden entirely when there is nothing to narrow: one bucket with work in it does
        not need a filter beside an "All" that would show the same rows.
      -->
      <template v-if="allSections.length > 1" #toolbar>
        <div
          class="flex flex-wrap items-center gap-2"
          role="group"
          :aria-label="$t('queue.focusLabel')"
        >
          <button
            type="button"
            class="rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors"
            :class="
              focus === 'all'
                ? 'bg-slate-800 text-white ring-slate-800'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
            "
            style="min-height: 2.25rem"
            :aria-pressed="focus === 'all'"
            @click="focus = 'all'"
          >
            {{ $t('leads.all') }}
          </button>

          <button
            v-for="s in allSections"
            :key="s.id"
            type="button"
            :class="[CHIP, focus === s.id ? s.chipOn : s.chipOff]"
            style="min-height: 2.25rem"
            :aria-pressed="focus === s.id"
            @click="focus = focus === s.id ? 'all' : s.id"
          >
            {{ s.label }}
            <!-- The count is the point of the chip as much as the label is, so it is
                 rendered at full strength rather than dimmed into decoration. -->
            <span class="tabular-nums opacity-80">{{ s.total }}</span>
          </button>
        </div>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="4" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">
        {{ $t('common.retry') }}
      </button>
    </div>

    <EmptyState
      v-else-if="nothingToDo"
      :title="$t('queue.allClear')"
      :body="$t('queue.allClearBody')"
    >
      <RouterLink v-if="auth.can.createLead" :to="{ name: 'lead-new' }" class="btn-primary">
        + {{ $t('nav.newLead') }}
      </RouterLink>
    </EmptyState>

    <!-- The last lead in the focused bucket can be cleared while it is on screen: the
         listener is live, so the rows simply vanish. Say what happened and offer the way
         back, rather than leaving a heading over an empty card. -->
    <EmptyState
      v-else-if="focusEmpty"
      :title="$t('queue.focusClear')"
      :body="$t('queue.focusClearBody')"
    >
      <button type="button" class="btn-secondary" @click="focus = 'all'">
        {{ $t('queue.showAll') }}
      </button>
    </EmptyState>

    <div v-else class="space-y-6">
      <section v-for="s in sections" :key="s.id" :aria-labelledby="`q-${s.id}`">
        <div class="mb-2.5 flex items-center gap-2">
          <h2
            :id="`q-${s.id}`"
            class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em]"
            :class="s.heading"
          >
            <!-- Colour is never the only signal (§13): the dot is a repetition of what the
                 heading already says in words, for the reader scanning rather than reading. -->
            <span class="size-2 rounded-full" :class="s.dot" aria-hidden="true" />
            {{ s.label }}
          </h2>
          <span
            class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5
                   text-xs font-semibold tabular-nums"
            :class="s.badge"
          >{{ s.total }}</span>
          <!-- A hairline carrying the eye from the heading to the rows it belongs to. -->
          <span class="h-px flex-1 bg-slate-200" aria-hidden="true" />
        </div>

        <!-- One card per section, rows hairlined inside it. `divide-y` rather than a border
             on each row, so the first and last rows meet the card's rounded corners cleanly. -->
        <div class="overflow-hidden rounded-xl bg-white shadow-sm ring-1" :class="s.card">
          <ul class="divide-y divide-slate-100">
            <li v-for="lead in s.shown" :key="lead.id">
              <QueueLeadRow
                :lead="lead"
                :bucket="s.id"
                :due="dueLabel(lead, s.id)"
                :owner-name="showOwner ? nameFor(lead.ownerId) : ''"
                @log="openLog"
              />
            </li>
          </ul>
        </div>

        <!-- Compact: the section heading already carries the label and the true total,
             so the paginator only needs its controls and a quiet count. -->
        <PaginationBar
          v-if="s.pager.pageCount.value > 1"
          compact
          :page="s.pager.page.value"
          :page-count="s.pager.pageCount.value"
          :from="s.pager.from.value"
          :to="s.pager.to.value"
          :total="s.pager.total.value"
          :per-page="s.pager.perPage.value"
          :pages="s.pager.windowFor(1)"
          :has-prev="s.pager.hasPrev.value"
          :has-next="s.pager.hasNext.value"
          @prev="s.pager.prev"
          @next="s.pager.next"
          @go="s.pager.go"
        />
      </section>
    </div>

    </div>

    <LogActivityDialog
      v-if="logTarget"
      :lead="logTarget"
      @close="logTarget = null"
    />
  </div>
</template>
