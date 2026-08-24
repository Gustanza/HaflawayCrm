<script setup>
/**
 * Campaigns — TODO.md §12 screen 9.
 *
 * Spend, leads, CPL, won, revenue, CAC and ROAS per campaign. Every row answers one
 * question: is this campaign worth running?
 *
 * Two things are load-bearing and both come from §8.5:
 *   - CAC with fewer than 3 won deals is greyed and labelled, because a CAC from one deal
 *     is noise and will otherwise be quoted in a meeting as though it were a measurement.
 *   - Every figure prints its denominator. `TZS 42,000 (n=7)`.
 *
 * Attribution is FIRST-TOUCH (P5) and the caption says so, because a CAC without a stated
 * attribution model is a lie with a decimal point.
 */
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import { campaignsQuery, leadsQuery } from '@/services/queries.js'
import { formatMoney, formatPercent } from '@/domain/money.js'
import { cacBy, revenueMinor, isWon, LOW_CONFIDENCE_N } from '@/domain/metrics.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MetricValue from '@/components/ui/MetricValue.vue'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items: campaigns, loading: loadingCampaigns, loaded, error, load } = useCollection(
  () => campaignsQuery(user.value, { max: 100 }),
)

const { items: leads, loading: loadingLeads } = useCollection(
  () => leadsQuery(user.value, { max: 500 }),
)

const loading = computed(() => loadingCampaigns.value || loadingLeads.value)

const byId = computed(() => new Map(campaigns.value.map((c) => [c.id, c])))

/**
 * `spendToDateMinor` is maintained transactionally on the campaign document as spend
 * entries are appended, so a row does not need to read the whole sub-collection.
 */
const rows = computed(() => {
  const measured = cacBy(
    leads.value,
    (lead) => lead.attribution?.campaignId ?? null,
    (campaignId) => ({
      expenses: [],
      campaignSpend: [{ amountMinor: byId.value.get(campaignId)?.spendToDateMinor ?? 0 }],
    }),
    // Campaign CAC is ad spend over customers won. Staff cost is not attributed here —
    // §9 puts that allocation in the per-staff view, where the policy applies.
    { includeSalariesInCAC: false, overheadMethod: 'none' },
  )

  const byCampaign = new Map(measured.map((row) => [row.key, row]))

  /**
   * Seed the table from CAMPAIGNS, not from the leads that reference them.
   *
   * Building rows only out of lead buckets silently dropped any campaign with zero
   * attributed leads — from the table AND from "Total spend". That is precisely the
   * campaign a manager needs to see: money went out, nothing came back. A screen whose
   * job is "is this advertising paying for itself" cannot hide the ones that are not.
   */
  return campaigns.value
    .map((campaign) => {
      const measuredRow = byCampaign.get(campaign.id)
      const spend = campaign.spendToDateMinor ?? 0
      const leadCount = measuredRow?.leads ?? 0

      return {
        key: campaign.id,
        // A campaign with no leads has no CAC and no win rate — null, never zero (§8.5).
        value: measuredRow?.value ?? null,
        n: measuredRow?.n ?? 0,
        lowConfidence: measuredRow?.lowConfidence ?? false,
        winRate: measuredRow?.winRate ?? { value: null, n: 0 },
        revenueMinor: measuredRow?.revenueMinor ?? 0,
        won: measuredRow?.won ?? 0,
        leads: leadCount,
        campaign,
        name: campaign.name ?? campaign.id,
        channel: campaign.channel ?? 'other',
        spendMinor: spend,
        budgetMinor: campaign.budgetMinor ?? 0,
        cplMinor: leadCount ? Math.round(spend / leadCount) : null,
        roas: spend ? (measuredRow?.revenueMinor ?? 0) / spend : null,
        // Flagged so the template can call it out rather than let a row of dashes pass
        // for a rendering glitch.
        spentNothingReturned: spend > 0 && leadCount === 0,
      }
    })
    // Biggest spend first: the rows that can lose the most money are the ones worth
    // reading. Ties break on name so the order is stable between renders — under
    // pagination an unstable sort can hide a row on every page or show it on two.
    .sort((a, b) => b.spendMinor - a.spendMinor || String(a.name).localeCompare(String(b.name)))
})

/**
 * `leadsQuery` is owner/team-scoped for a manager but org-wide for finance and admin,
 * while `campaignsQuery` is always org-wide. So a manager sees every campaign's SPEND but
 * only their own team's LEADS against it — which would make every campaign look worse
 * than it is. Say so rather than let them draw the wrong conclusion.
 */
const leadScopeIsNarrow = computed(() => auth.role === 'manager')

/**
 * Same choice as the CAC-per-staff table on the dashboard, and for the same reason: this
 * table is browsed and compared, not worked through, so a reader needs an addressable
 * position ("page 2 of 3") and a way back rather than an ever-growing "show more" list.
 * Five campaigns today, fifty soon.
 */
const pager = usePagination(rows, { pageSize: 25 })

/**
 * Totals are computed over `rows` and over every loaded lead — never over `pager.items`.
 * A headline that changes when you turn the page is not a total.
 */
const totals = computed(() => {
  const spend = rows.value.reduce((t, r) => t + r.spendMinor, 0)
  const revenue = revenueMinor(leads.value)
  return {
    spend,
    revenue,
    leads: rows.value.reduce((t, r) => t + r.leads, 0),
    won: leads.value.filter(isWon).length,
    roas: spend ? revenue / spend : null,
  }
})
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.campaigns')" :subtitle="$t('campaigns.subtitle')" />

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="4" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <EmptyState
      v-else-if="loaded && !campaigns.length"
      :title="$t('campaigns.none')"
      :body="$t('campaigns.noneBody')"
    />

    <template v-else>
      <!-- Headline row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('campaigns.totalSpend') }}</p>
          <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {{ formatMoney(totals.spend, 'TZS', { compact: true }) }}
          </p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('campaigns.revenue') }}</p>
          <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {{ formatMoney(totals.revenue, 'TZS', { compact: true }) }}
          </p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('campaigns.leads') }}</p>
          <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">{{ totals.leads }}</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-slate-500">{{ $t('campaigns.roas') }}</p>
          <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {{ totals.roas === null ? '—' : `${totals.roas.toFixed(2)}×` }}
          </p>
        </div>
      </div>

      <!-- P5: name the attribution model on anything derived from it. -->
      <p class="mb-1 text-xs text-slate-500">{{ $t('campaigns.attributionNote') }}</p>
      <p v-if="leadScopeIsNarrow" class="mb-3 text-xs text-amber-700">
        {{ $t('campaigns.teamScopeNote') }}
      </p>
      <p v-else class="mb-3" />

      <div class="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
        <table class="w-full min-w-[46rem] text-sm">
          <thead>
            <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
              <th class="py-2 pr-3 font-medium">{{ $t('campaigns.campaign') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ $t('campaigns.spend') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ $t('campaigns.leads') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ $t('campaigns.cpl') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ $t('campaigns.won') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ $t('campaigns.cac') }}</th>
              <th class="py-2 pl-3 font-medium text-right">{{ $t('campaigns.roas') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in pager.items.value" :key="row.key">
              <td class="py-3 pr-3">
                <p class="font-medium text-slate-900">{{ row.name }}</p>
                <p class="text-xs text-slate-500">
                  {{ $t(`source.${row.channel}`) }}
                  <span v-if="row.spentNothingReturned" class="ml-1 text-rose-700 font-medium">
                    · {{ $t('campaigns.noLeads') }}
                  </span>
                </p>
              </td>
              <td class="py-3 px-3 text-right tabular-nums text-slate-700">
                {{ formatMoney(row.spendMinor, 'TZS', { compact: true }) }}
              </td>
              <td class="py-3 px-3 text-right tabular-nums text-slate-700">{{ row.leads }}</td>
              <td class="py-3 px-3 text-right tabular-nums text-slate-700">
                {{ formatMoney(row.cplMinor, 'TZS', { compact: true }) }}
              </td>
              <td class="py-3 px-3 text-right tabular-nums text-slate-700">{{ row.won }}</td>
              <td class="py-3 px-3 text-right">
                <MetricValue
                  :value="row.value"
                  :n="row.n"
                  :low-confidence="row.lowConfidence"
                  money
                />
              </td>
              <td class="py-3 pl-3 text-right tabular-nums text-slate-700">
                {{ row.roas === null ? '—' : `${row.roas.toFixed(2)}×` }}
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

      <p class="mt-3 text-xs text-slate-500">
        {{ $t('metrics.lowConfidenceNote', { n: LOW_CONFIDENCE_N }) }}
      </p>
    </template>
    </div>
  </div>
</template>
