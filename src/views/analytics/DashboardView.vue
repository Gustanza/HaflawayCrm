<script setup>
/**
 * The CAC dashboard — TODO.md §12 screen 11 and §8.5. The reason the product exists.
 *
 * Non-negotiables, all from §8:
 *   - COHORT / PERIOD toggle with a caption saying which question is being answered.
 *     "August CAC" is ambiguous and the two readings differ by a lot (§8.8).
 *   - The active cost policy is printed next to the number. Including salaries changes CAC
 *     by a factor of several, so a figure without its policy is meaningless (§9).
 *   - Every ratio prints its denominator; fewer than 3 won deals is greyed and flagged.
 *   - Nothing renders as 0 when it means "unknown".
 *
 * Computed live from documents rather than from rollups. That is honest at this scale
 * (hundreds of leads) and lets every figure drill down (P11). Phase 6 replaces the maths
 * with pre-aggregated rollup docs when the volume justifies it — the formulas in
 * src/domain/metrics.js stay exactly the same.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import { leadsQuery, expensesQuery, campaignsQuery, fetchCampaignSpend } from '@/services/queries.js'
import { formatMoney, formatPercent } from '@/domain/money.js'
import { recentMonthKeys, monthKey as monthKeyOf } from '@/domain/periods.js'
import {
  summarise, cohort, closedIn, cacBy, funnel, LOW_CONFIDENCE_N,
} from '@/domain/metrics.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import MetricValue from '@/components/ui/MetricValue.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import BarChart from '@/components/ui/BarChart.vue'

const auth = useAuthStore()
const { t } = useI18n()
const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items: leads, loading: loadingLeads, loaded } = useCollection(
  () => leadsQuery(user.value, { max: 500 }),
)
const { items: expenses, loading: loadingExpenses } = useCollection(
  () => (auth.can.viewCosts ? expensesQuery(user.value, { max: 500 }) : null),
)
const { items: campaigns, loading: loadingCampaigns } = useCollection(
  () => (auth.can.viewCosts ? campaignsQuery(user.value, { max: 100 }) : null),
)

/**
 * `campaigns/{id}/spend` is a per-campaign subcollection, not one queryable collection (see
 * fetchCampaignSpend()'s docstring in queries.js) — so it cannot be a plain useCollection()
 * the way leads/expenses/campaigns are. Loaded once the campaign list settles, and reloaded
 * if it changes. Without this the CAC this whole screen exists to compute silently excluded
 * every shilling of ad spend — campaignSpend was hardcoded to [] throughout this file.
 */
const campaignSpend = shallowRef([])
const loadingCampaignSpend = ref(false)
watch(
  () => (loadingCampaigns.value ? null : campaigns.value.map((c) => c.id)),
  async (campaignIds) => {
    if (!campaignIds) return
    // Mirrors the expensesQuery/campaignsQuery guard above: a viewer never has cost
    // access, campaigns.value is always [] for them, and fetchCampaignSpend() asserts
    // cost access BEFORE checking for an empty list — so this must short-circuit here
    // rather than call it with zero ids and let it throw.
    if (!auth.can.viewCosts || campaignIds.length === 0) {
      campaignSpend.value = []
      return
    }
    loadingCampaignSpend.value = true
    try {
      campaignSpend.value = await fetchCampaignSpend(user.value, campaignIds)
    } finally {
      loadingCampaignSpend.value = false
    }
  },
  { immediate: true },
)

const loading = computed(
  () => loadingLeads.value || loadingExpenses.value || loadingCampaigns.value || loadingCampaignSpend.value,
)

/** This month's campaign spend entries, the same way monthExpenses filters expenses. */
const spendForMonth = (key) => campaignSpend.value.filter((s) => s.monthKey === key)

/**
 * A viewer may open this screen but may NOT read expenses (§7.1). With no cost documents
 * every cost-derived figure computes to zero — and "CAC: TZS 0" reads as "customers are
 * free", which is worse than showing nothing at all. So the cost half of the dashboard is
 * hidden for roles that cannot see the inputs, and the reason is stated.
 */
const canSeeCosts = computed(() => auth.can.viewCosts)

// The per-staff table grouped by ownerId and printed the raw uid — unreadable to the
// manager the table is written for. Resolved through the redacted usersPublic mirror,
// never the full user document (§7.1).
const { nameFor } = useUserNames(() => auth.orgId)

const months = computed(() => recentMonthKeys(6))
const selectedMonth = ref(monthKeyOf(new Date()))

/** §8.8. Default cohort, because "was that month's money well spent" is the real question. */
const basis = ref('cohort')

/**
 * §9. Hard-coded to the documented defaults until the policy editor exists (Phase 5).
 * Whatever it is, it is PRINTED on the screen — a CAC without its policy is not a figure.
 */
const policy = {
  includeSalariesInCAC: true,
  includeCommissionInCAC: false,
  overheadMethod: 'by_revenue',
  attributionModel: 'first_touch',
}

const monthLeads = computed(() =>
  basis.value === 'cohort'
    ? cohort(leads.value, selectedMonth.value)
    : closedIn(leads.value, selectedMonth.value),
)

const monthExpenses = computed(() =>
  expenses.value.filter((e) => e.monthKey === selectedMonth.value),
)

const summary = computed(() =>
  summarise(
    monthLeads.value,
    { expenses: monthExpenses.value, campaignSpend: spendForMonth(selectedMonth.value) },
    policy,
  ),
)

/** §8.8: a cohort whose deals are still open understates itself. Say so rather than imply. */
const cohortIncomplete = computed(
  () => basis.value === 'cohort' && selectedMonth.value === monthKeyOf(new Date()),
)

/** §8.5 CAC_staff — the politically loaded one, so the guard rails matter most here. */
const perStaff = computed(() =>
  cacBy(
    monthLeads.value,
    (lead) => lead.ownerId,
    (uid) => ({
      expenses: monthExpenses.value.filter((e) => e.allocation?.staffId === uid),
      campaignSpend: [],
    }),
    policy,
  ),
)

/**
 * Ordering for the per-staff table, and it is a judgement call, so it is written down.
 *
 * NOT sorted by CAC. Sorting people by their own CAC turns a figure §8.5 already calls
 * noise at small n into a leaderboard: whoever got lucky with one cheap win floats to the
 * top, whoever carried a hard month sinks to the bottom, and the order itself starts
 * reading as a verdict. The guard rails exist precisely so this number is NOT ranked.
 *
 * Sorted by leads handled, descending — the ordering `cacBy` already returns, kept
 * explicit here so it survives a change upstream. It is descriptive rather than
 * evaluative (workload, not performance), and it is the ordering that keeps a truncated
 * page useful: the people who handled the most leads carry most of the month's cost, so
 * the first page accounts for most of the denominator. Ties break on won, then on key, so
 * the order is stable between renders — a table that reshuffles under pagination makes
 * page 2 unreadable.
 */
const perStaffRows = computed(() =>
  [...perStaff.value].sort(
    (a, b) => b.leads - a.leads || b.won - a.won || String(a.key).localeCompare(String(b.key)),
  ),
)

/**
 * Real pagination here, not "show more".
 *
 * The work queue is WORKED — you take the top item and the rest is backlog, so a growing
 * "show more" list is right there. This table is BROWSED and COMPARED: ~50 staff, and a
 * manager arrives wanting one specific person's row, or wanting to know how far down the
 * list someone sits. That needs a stable, addressable position ("page 2 of 3", "showing
 * 26-50 of 50") and a way back, which PaginationBar gives and an ever-growing list does
 * not. The per-page selector also lets a manager put all 50 on one screen to compare —
 * the one case where truncation is actively unhelpful.
 */
const staffPager = usePagination(perStaffRows, { pageSize: 25 })

// Changing the month or the cohort/period basis rebuilds the table completely. Without
// this you stay on page 3 of a month that now has one page and conclude there is no data.
watch([selectedMonth, basis], () => staffPager.reset())

/**
 * Per-channel and loss reasons are bounded by taxonomy, not by company size: 7 channels
 * and 8 loss reasons, fixed in the locale files. They cannot grow with the business, so
 * they get no pagination — machinery on a 7-row list is cost with no benefit.
 * The funnel (5 stages) and the trend (6 months) are fixed-length for the same reason.
 */
/** A spend entry's channel comes from its PARENT campaign — spend docs carry no channel
 *  of their own (see fetchCampaignSpend()'s docstring). 'other' matches the fallback every
 *  other channel-keyed figure on this screen already uses for an unattributed lead. */
const campaignChannelById = computed(
  () => new Map(campaigns.value.map((c) => [c.id, c.channel ?? 'other'])),
)
const spendByChannelForMonth = (key) => {
  const byChannel = new Map()
  for (const entry of spendForMonth(key)) {
    const channel = campaignChannelById.value.get(entry.campaignId) ?? 'other'
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), entry])
  }
  return byChannel
}

const perChannel = computed(() => {
  const byChannel = spendByChannelForMonth(selectedMonth.value)
  return cacBy(
    monthLeads.value,
    (lead) => lead.attribution?.channel ?? lead.attribution?.source ?? null,
    (channel) => ({ expenses: [], campaignSpend: byChannel.get(channel) ?? [] }),
    policy,
  )
})

const steps = computed(() => funnel(monthLeads.value))

const trend = computed(() =>
  months.value.map((key) => {
    const set = basis.value === 'cohort' ? cohort(leads.value, key) : closedIn(leads.value, key)
    const costs = {
      expenses: expenses.value.filter((e) => e.monthKey === key),
      campaignSpend: spendForMonth(key),
    }
    return { monthKey: key, ...summarise(set, costs, policy) }
  }),
)

/** Chart-ready shape for BarChart.vue — one bar per month, height by revenue. */
const trendChartItems = computed(() =>
  trend.value.map((month) => ({
    key: month.monthKey,
    label: month.monthKey,
    value: month.revenueMinor ?? 0,
    direct: `${month.won}w`,
  })),
)

/** Chart-ready shape for BarChart.vue — one bar per stage, width by count. */
const funnelChartItems = computed(() =>
  steps.value.map((step) => ({
    key: step.stage,
    label: t(`funnel.${step.stage}`),
    value: step.count,
    direct: step.dropoff === null ? '' : `-${formatPercent(step.dropoff, 0)}`,
  })),
)
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.analytics')" :subtitle="$t('analytics.subtitle')">
      <!-- The month picker and the cohort/period toggle decide what every figure below
           MEANS, so they belong to the header rather than scrolling away with the page. -->
      <template #toolbar>
        <div class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="key in months"
          :key="key"
          type="button"
          class="rounded-full px-3.5 text-sm font-medium ring-1 ring-inset ring-slate-400
                 bg-white text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white
                 data-[on=true]:ring-slate-800"
          style="min-height: 2.25rem"
          :data-on="selectedMonth === key"
          @click="selectedMonth = key"
        >
          {{ key }}
        </button>
      </div>

      <!-- §8.8 — the toggle is required, and so is the caption under it. -->
      <div>
        <div class="inline-flex rounded-lg ring-1 ring-slate-400 ring-inset overflow-hidden">
          <button
            v-for="option in ['cohort', 'period']"
            :key="option"
            type="button"
            class="px-4 text-sm font-medium"
            style="min-height: 2.25rem"
            :class="basis === option ? 'bg-brand-600 text-white' : 'bg-white text-slate-700'"
            :aria-pressed="basis === option"
            @click="basis = option"
          >
            {{ $t(`analytics.${option}`) }}
          </button>
        </div>
        <p class="mt-1.5 text-xs text-slate-600">{{ $t(`analytics.${basis}Caption`) }}</p>
      </div>

      <p v-if="cohortIncomplete" class="rounded-lg bg-amber-50 ring-1 ring-amber-300 p-3 text-sm text-amber-900">
        {{ $t('analytics.incompleteCohort') }}
      </p>
        </div>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="4" />

    <template v-else>
      <p
        v-if="!canSeeCosts"
        class="mb-4 rounded-lg bg-slate-100 ring-1 ring-slate-300 p-3 text-sm text-slate-700"
      >
        {{ $t('analytics.noCostAccess') }}
      </p>

      <!-- The headline. CAC is the number this system exists to produce. -->
      <section v-if="canSeeCosts" class="card p-4 mb-4">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-medium text-slate-500">{{ $t('analytics.cac') }}</h2>
          <span class="text-xs text-slate-400">{{ selectedMonth }}</span>
        </div>
        <p class="mt-1 text-3xl font-semibold">
          <MetricValue
            :value="summary.cac.value"
            :n="summary.cac.n"
            :low-confidence="summary.cac.lowConfidence"
            money
          />
        </p>
        <!-- §9: the policy is part of the number, not a footnote. -->
        <p class="mt-2 text-xs text-slate-500">
          {{ $t('analytics.policyNote', {
            salaries: policy.includeSalariesInCAC ? $t('common.yes') : $t('common.no'),
            commission: policy.includeCommissionInCAC ? $t('common.yes') : $t('common.no'),
            overhead: $t(`overheadMethod.${policy.overheadMethod}`),
            model: $t(`attributionModel.${policy.attributionModel}`),
          }) }}
        </p>
      </section>

      <!-- Volume and money -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.leadsCreated') }}</p>
          <p class="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{{ summary.created }}</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.won') }}</p>
          <p class="mt-0.5 text-lg font-semibold text-emerald-700 tabular-nums">{{ summary.won }}</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.lost') }}</p>
          <p class="mt-0.5 text-lg font-semibold text-rose-700 tabular-nums">{{ summary.lost }}</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.revenue') }}</p>
          <p class="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">
            {{ formatMoney(summary.revenueMinor, 'TZS', { compact: true }) }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div v-if="canSeeCosts" class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.investment') }}</p>
          <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {{ formatMoney(summary.costMinor, 'TZS', { compact: true }) }}
          </p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.winRate') }}</p>
          <p class="mt-0.5 font-semibold">
            <MetricValue :value="summary.winRate.value" :n="summary.winRate.n" percent />
          </p>
        </div>
        <div v-if="canSeeCosts" class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.cpl') }}</p>
          <p class="mt-0.5 font-semibold">
            <MetricValue :value="summary.cpl.value" :n="summary.cpl.n" money :show-n="false" />
          </p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('analytics.salesCycle') }}</p>
          <p class="mt-0.5 font-semibold">
            <MetricValue
              :value="summary.salesCycleDays.value"
              :n="summary.salesCycleDays.n"
              :suffix="` ${$t('analytics.days')}`"
              :show-n="false"
            />
          </p>
        </div>
      </div>

      <!-- Trend: one bar per month, height by revenue; won count direct-labeled above each bar. -->
      <section class="card p-4 mb-4">
        <h2 class="text-sm font-semibold text-slate-800 mb-3">{{ $t('analytics.trend') }}</h2>
        <BarChart
          orientation="vertical"
          :items="trendChartItems"
          :value-formatter="(v) => formatMoney(v, 'TZS', { compact: true })"
          hue="var(--color-brand-500)"
          :aria-label="$t('analytics.trend')"
        />
      </section>

      <!-- Funnel: one bar per stage, width by count; drop-off direct-labeled beside each bar. -->
      <section class="card p-4 mb-4">
        <h2 class="text-sm font-semibold text-slate-800 mb-3">{{ $t('analytics.funnel') }}</h2>
        <BarChart
          orientation="horizontal"
          :items="funnelChartItems"
          :value-formatter="(v) => String(v)"
          hue="var(--color-slate-600)"
          :aria-label="$t('analytics.funnel')"
        />
      </section>

      <!-- CAC per staff. The politically loaded table — guard rails on full display. -->
      <section v-if="canSeeCosts" class="card p-4 mb-4">
        <h2 class="text-sm font-semibold text-slate-800">{{ $t('analytics.perStaff') }}</h2>
        <p class="mt-0.5 mb-3 text-xs text-slate-500">{{ $t('analytics.perStaffNote') }}</p>

        <div v-if="!perStaffRows.length" class="py-4 text-center text-sm text-slate-400">
          {{ $t('analytics.noData') }}
        </div>

        <div v-else class="data-table-wrap">
          <table class="data-table min-w-[32rem]">
            <thead>
              <tr>
                <th>{{ $t('analytics.staff') }}</th>
                <th class="text-right">{{ $t('analytics.leadsCreated') }}</th>
                <th class="text-right">{{ $t('analytics.won') }}</th>
                <th class="text-right">{{ $t('analytics.winRate') }}</th>
                <th class="text-right">{{ $t('analytics.cac') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in staffPager.items.value" :key="row.key">
                <td class="text-slate-900">{{ nameFor(row.key) }}</td>
                <td class="num">{{ row.leads }}</td>
                <td class="num">{{ row.won }}</td>
                <td class="text-right">
                  <MetricValue :value="row.winRate.value" :n="row.winRate.n" percent :show-n="false" />
                </td>
                <td class="text-right">
                  <MetricValue
                    :value="row.value"
                    :n="row.n"
                    :low-confidence="row.lowConfidence"
                    money
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <PaginationBar
          v-if="perStaffRows.length"
          :page="staffPager.page.value"
          :page-count="staffPager.pageCount.value"
          :from="staffPager.from.value"
          :to="staffPager.to.value"
          :total="staffPager.total.value"
          :per-page="staffPager.perPage.value"
          :pages="staffPager.windowFor(2)"
      :sizes="PAGE_SIZES"
          :has-prev="staffPager.hasPrev.value"
          :has-next="staffPager.hasNext.value"
          @prev="staffPager.prev"
          @next="staffPager.next"
        @go="staffPager.go"
          @per-page="staffPager.setPerPage"
        />

        <p class="mt-3 text-xs text-slate-500">
          {{ $t('metrics.lowConfidenceNote', { n: LOW_CONFIDENCE_N }) }}
        </p>
      </section>

      <!-- Channels and loss reasons -->
      <div class="grid sm:grid-cols-2 gap-3">
        <section class="card p-4">
          <h2 class="text-sm font-semibold text-slate-800 mb-3">{{ $t('analytics.perChannel') }}</h2>
          <div v-if="!perChannel.length" class="text-sm text-slate-400">
            {{ $t('analytics.noData') }}
          </div>
          <div v-else class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('analytics.perChannel') }}</th>
                  <th class="text-right">{{ $t('analytics.leadsCreated') }} → {{ $t('analytics.won') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in perChannel" :key="row.key">
                  <td class="text-slate-700">{{ $t(`source.${row.key}`) }}</td>
                  <td class="num">{{ row.leads }} → {{ row.won }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card p-4">
          <h2 class="text-sm font-semibold text-slate-800 mb-3">{{ $t('analytics.lossReasons') }}</h2>
          <div v-if="!summary.lossReasons.length" class="text-sm text-slate-400">
            {{ $t('analytics.noData') }}
          </div>
          <div v-else class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ $t('analytics.lossReasons') }}</th>
                  <th class="text-right">{{ $t('analytics.countShare') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in summary.lossReasons" :key="row.reason">
                  <td class="text-slate-700">{{ $t(`lossReason.${row.reason}`) }}</td>
                  <td class="num">{{ row.count }} · {{ formatPercent(row.share, 0) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
    </div>
  </div>
</template>
