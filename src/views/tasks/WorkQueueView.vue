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
 */
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { leadsQuery } from '@/services/queries.js'
import { priorityScore } from '@/domain/scoring.js'
import { daysToEvent, toDate, dayKey } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LeadRow from '@/components/leads/LeadRow.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const { t } = useI18n()

const user = computed(() => ({
  uid: auth.uid,
  role: auth.role,
  orgId: auth.orgId,
  teamId: auth.teamId,
  displayName: auth.displayName,
}))

// Live: this is the agent's home screen and a completed follow-up must disappear from it
// immediately. One of the few places real-time earns its read cost (§11.3).
const { items, loading, loaded, error, load } = useCollection(
  () => leadsQuery(user.value, { leadStatus: 'open', max: 100 }),
  { live: true },
)

/** Sorted by the score the agent should actually act on. */
const ranked = computed(() =>
  [...items.value]
    .map((lead) => ({ lead, score: priorityScore(lead) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.lead),
)

const today = computed(() => dayKey(new Date()))

function bucketOf(lead) {
  const next = toDate(lead.nextActionAt)
  if (!next) return 'upcoming'
  if (next.getTime() < Date.now()) return 'overdue'
  if (dayKey(next) === today.value) return 'today'
  const days = daysToEvent(lead.nextActionAt)
  return days !== null && days <= 7 ? 'upcoming' : 'later'
}

const overdue = computed(() => ranked.value.filter((l) => bucketOf(l) === 'overdue'))
const dueToday = computed(() => ranked.value.filter((l) => bucketOf(l) === 'today'))
const upcoming = computed(() => ranked.value.filter((l) => bucketOf(l) === 'upcoming'))

const nothingToDo = computed(
  () => loaded.value && !overdue.value.length && !dueToday.value.length && !upcoming.value.length,
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
 * Page size 10: about a screen and a half of cards on a phone, and well above the real
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

const SECTION_STYLE = {
  overdue: { heading: 'text-rose-700', badge: 'bg-rose-600 text-white' },
  today: { heading: 'text-slate-800', badge: 'bg-slate-700 text-white' },
  upcoming: { heading: 'text-slate-600', badge: 'bg-slate-200 text-slate-700' },
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
const sections = computed(() =>
  [
    section('overdue', overdue.value),
    section('today', dueToday.value),
    section('upcoming', upcoming.value),
  ].filter((s) => s.total > 0),
)

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
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.workQueue')">
      <template #subtitle>
        {{ $t('queue.subtitle', { count: dueCount }) }}
        <span v-if="later.length" class="text-slate-400">
          · {{ $t('queue.scheduledLater', { count: later.length }) }}
        </span>
      </template>
      <template v-if="auth.can.createLead" #actions>
        <RouterLink :to="{ name: 'lead-new' }" class="btn-primary text-sm">
          + {{ $t('nav.newLead') }}
        </RouterLink>
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

    <div v-else class="space-y-6">
      <section v-for="s in sections" :key="s.id" :aria-labelledby="`q-${s.id}`">
        <h2
          :id="`q-${s.id}`"
          class="mb-2 flex items-center gap-2 text-sm font-semibold"
          :class="s.heading"
        >
          <span
            class="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs"
            :class="s.badge"
          >{{ s.total }}</span>
          {{ s.label }}
        </h2>

        <!-- One column on a phone; two from 1024px, three from 1536px. Row-major, so the
             priority order still reads 1,2 / 3,4 rather than down each column. A ranked
             list survives that; it would not survive column-major flow. -->
        <div class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3 items-start">
          <LeadRow v-for="lead in s.shown" :key="lead.id" :lead="lead" @log="openLog" />
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
