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
import { useNow } from '@/composables/useNow.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { leadsQuery } from '@/services/queries.js'
import { priorityScore } from '@/domain/scoring.js'
import { daysToEvent, toDate, dayKey } from '@/domain/periods.js'
import { formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
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

const today = computed(() => dayKey(now.value))

function bucketOf(lead) {
  const next = toDate(lead.nextActionAt)
  if (!next) return 'upcoming'
  if (next.getTime() < now.value.getTime()) return 'overdue'
  if (dayKey(next) === today.value) return 'today'
  const days = daysToEvent(lead.nextActionAt, now.value)
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

/** Context-appropriate "Due" cell — a bare time in Today, a full date further out. */
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

        <div class="data-table-wrap">
          <table class="data-table min-w-[46rem]">
            <thead>
              <tr>
                <th>{{ $t('leads.name') }}</th>
                <th>{{ $t('leads.event') }}</th>
                <th>{{ $t('leads.stage') }}</th>
                <th v-if="canSeeOtherOwners">{{ $t('leads.owner') }}</th>
                <th>{{ $t('queue.due') }}</th>
                <th>{{ $t('leads.phone') }}</th>
                <th class="text-right">{{ $t('leads.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lead in s.shown" :key="lead.id" :class="s.id === 'overdue' ? 'bg-rose-50/40' : ''">
                <td>
                  <RouterLink
                    :to="{ name: 'lead-detail', params: { id: lead.id } }"
                    class="font-medium text-slate-900 hover:text-brand-700"
                  >
                    {{ lead.displayName || $t('lead.unnamed') }}
                  </RouterLink>
                </td>
                <td>
                  <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" compact />
                </td>
                <td><StageBadge :stage="lead.stage" /></td>
                <td v-if="canSeeOtherOwners" class="text-slate-600">{{ nameFor(lead.ownerId) }}</td>
                <td :class="s.id === 'overdue' ? 'text-rose-700 font-medium' : 'text-slate-600'">
                  {{ dueLabel(lead, s.id) }}
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
                      @click="openLog(lead)"
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
