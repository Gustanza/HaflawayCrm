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
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { addDoc, collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import { campaignsQuery, leadsQuery, fetchCampaignSpend } from '@/services/queries.js'
import { formatMoney, formatPercent, divideMinor, toMinor } from '@/domain/money.js'
import { cacBy, revenueMinor, isWon, LOW_CONFIDENCE_N } from '@/domain/metrics.js'
import { LEAD_SOURCES } from '@/domain/taxonomies.js'
import { periodKeys } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MetricValue from '@/components/ui/MetricValue.vue'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()
const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items: campaigns, loading: loadingCampaigns, loaded, error, load } = useCollection(
  () => campaignsQuery(user.value, { max: 100 }),
)

const { items: leads, loading: loadingLeads } = useCollection(
  () => leadsQuery(user.value, { max: 500 }),
)

/**
 * Creating a campaign — firestore.rules gates this on isFinance() (admin/finance), same as
 * `auth.can.editCosts`. A manager can READ this screen but not create a campaign; the button
 * is hidden for them rather than shown and denied.
 */
const showForm = ref(false)
const newName = ref('')
const newChannel = ref(LEAD_SOURCES[0])
const newBudget = ref('')
const saving = ref(false)

const newBudgetMinor = computed(() => (newBudget.value.trim() ? toMinor(newBudget.value) : 0))
const canSaveCampaign = computed(
  () => newName.value.trim().length > 0 && newBudgetMinor.value !== null && !saving.value,
)

async function saveCampaign() {
  if (!canSaveCampaign.value) return
  saving.value = true
  try {
    const db = await getDb()
    // Same id on both documents, generated client-side, so the batch below can write the
    // full campaign AND its redacted (name/channel only, no budget — §7.2) mirror atomically.
    const campaignRef = doc(collection(db, 'campaigns'))
    const now = serverTimestamp()
    const batch = writeBatch(db)
    batch.set(campaignRef, {
      orgId: auth.orgId,
      name: newName.value.trim(),
      channel: newChannel.value,
      budgetMinor: newBudgetMinor.value,
      status: 'active',
      startDate: now,
      ownerId: auth.uid,
      createdAt: now,
      createdBy: auth.uid,
      updatedAt: now,
      updatedBy: auth.uid,
    })
    batch.set(doc(db, 'campaignsPublic', campaignRef.id), {
      orgId: auth.orgId,
      name: newName.value.trim(),
      channel: newChannel.value,
      status: 'active',
    })
    await batch.commit()

    ui.success(t('campaigns.added'))
    newName.value = ''
    newBudget.value = ''
    newChannel.value = LEAD_SOURCES[0]
    showForm.value = false
    load()
  } catch {
    ui.error(t('errors.write.permissionDenied'))
  } finally {
    saving.value = false
  }
}

/**
 * Recording what a campaign actually cost.
 *
 * Writes an entry to `campaigns/{id}/spend`, which is the ONLY source of truth for spend -
 * `campaign.budgetMinor` is a plan and `spendToDateMinor` is decorative. Until this existed
 * the ledger had exactly one writer, the seed script, so a real deployment could never
 * produce a per-campaign CAC at all.
 *
 * APPEND-ONLY (P4), enforced by firestore.rules: no update, no delete. A mistake is
 * corrected by posting another entry, not by editing this one. The date is free so you can
 * back-date yesterday's Facebook receipt, and `periodKeys` stamps the month FROM THAT DATE -
 * booking it against the month the money was actually spent, not the month it was typed in.
 */
const showSpendForm = ref(false)
const spendCampaignId = ref('')
const spendAmount = ref('')
const spendDate = ref(new Date().toISOString().slice(0, 10))
const savingSpend = ref(false)

const spendAmountMinor = computed(() =>
  spendAmount.value.trim() ? toMinor(spendAmount.value) : null,
)
const canSaveSpend = computed(
  () =>
    !savingSpend.value &&
    spendCampaignId.value !== '' &&
    spendAmountMinor.value !== null &&
    spendAmountMinor.value > 0 &&
    spendDate.value !== '',
)

async function saveSpend() {
  if (!canSaveSpend.value) return
  savingSpend.value = true
  try {
    const db = await getDb()
    // Midday, so a timezone shift cannot move the entry into the previous or next day and
    // therefore into the wrong monthKey at a month boundary.
    const spentOn = new Date(`${spendDate.value}T12:00:00`)
    await addDoc(collection(db, 'campaigns', spendCampaignId.value, 'spend'), {
      ...periodKeys(spentOn),
      spentOn,
      amountMinor: spendAmountMinor.value,
      currency: 'TZS',
      source: 'manual',
      // firestore.rules requires this to equal the caller's uid - an entry cannot be
      // posted in somebody else's name.
      enteredBy: auth.uid,
      createdAt: serverTimestamp(),
    })

    ui.success(t('campaigns.spendAdded'))
    spendAmount.value = ''
    showSpendForm.value = false
    // Re-read the ledger so the row's spend, CPL, CAC and ROAS update immediately.
    campaignSpend.value = await fetchCampaignSpend(user.value, campaigns.value.map((c) => c.id))
  } catch {
    ui.error(t('errors.write.permissionDenied'))
  } finally {
    savingSpend.value = false
  }
}

/**
 * `campaign.spendToDateMinor` looks like a running total but nothing in this codebase ever
 * writes it from real spend entries — it is stale/decorative (confirmed against the seeded
 * ledger, off by up to ~10x). The real spend ledger is `campaigns/{id}/spend`, fetched here
 * once the campaign list settles; see fetchCampaignSpend()'s docstring in queries.js for why
 * this cannot be a plain useCollection() the way campaigns/leads are.
 */
const campaignSpend = shallowRef([])
watch(
  () => (loadingCampaigns.value ? null : campaigns.value.map((c) => c.id)),
  async (campaignIds) => {
    if (!campaignIds) return
    // This screen is route-gated to admin/manager/finance in real use, but that guard is
    // convenience, not access control (TODO.md P10) — fetchCampaignSpend() itself refuses a
    // role with no cost access, so check first rather than let it throw unhandled.
    if (!auth.can.viewCosts || campaignIds.length === 0) {
      campaignSpend.value = []
      return
    }
    campaignSpend.value = await fetchCampaignSpend(user.value, campaignIds)
  },
  { immediate: true },
)

const loading = computed(() => loadingCampaigns.value || loadingLeads.value)

const byId = computed(() => new Map(campaigns.value.map((c) => [c.id, c])))

/** Real spend, summed from the ledger — grouped by campaign so each row reads its own slice. */
const spendMinorById = computed(() => {
  const totals = new Map()
  for (const entry of campaignSpend.value) {
    totals.set(entry.campaignId, (totals.get(entry.campaignId) ?? 0) + (entry.amountMinor ?? 0))
  }
  return totals
})

const rows = computed(() => {
  const measured = cacBy(
    leads.value,
    (lead) => lead.attribution?.campaignId ?? null,
    (campaignId) => ({
      expenses: [],
      campaignSpend: [{ amountMinor: spendMinorById.value.get(campaignId) ?? 0 }],
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
      const spend = spendMinorById.value.get(campaign.id) ?? 0
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
        cplMinor: leadCount ? divideMinor(spend, leadCount) : null,
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
    <PageHeader :title="$t('nav.campaigns')" :subtitle="$t('campaigns.subtitle')">
      <template v-if="auth.can.editCosts" #actions>
        <button
          type="button"
          class="btn-secondary text-sm"
          :disabled="!campaigns.length"
          @click="showSpendForm = !showSpendForm; showForm = false"
        >
          + {{ $t('campaigns.addSpend') }}
        </button>
        <button
          type="button"
          class="btn-primary text-sm"
          @click="showForm = !showForm; showSpendForm = false"
        >
          + {{ $t('campaigns.add') }}
        </button>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <!-- Recording real spend. Append-only: this posts a new ledger entry every time. -->
    <section v-if="showSpendForm" class="card p-4 mb-4">
      <h2 class="font-medium text-slate-900 mb-1">{{ $t('campaigns.addSpend') }}</h2>
      <p class="text-sm text-slate-600 mb-3">{{ $t('campaigns.addSpendHint') }}</p>

      <div class="space-y-3">
        <div>
          <label for="s-campaign" class="field-label">{{ $t('campaigns.name') }}</label>
          <select id="s-campaign" v-model="spendCampaignId" class="field-input">
            <option value="">{{ $t('common.select') }}</option>
            <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="s-amount" class="field-label">{{ $t('campaigns.spend') }}</label>
            <input
              id="s-amount"
              v-model="spendAmount"
              type="text"
              inputmode="decimal"
              class="field-input"
              placeholder="250000"
            />
          </div>
          <div>
            <label for="s-date" class="field-label">{{ $t('campaigns.spentOn') }}</label>
            <input id="s-date" v-model="spendDate" type="date" class="field-input" />
          </div>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-secondary flex-1" @click="showSpendForm = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn-primary flex-1"
            :disabled="!canSaveSpend"
            @click="saveSpend"
          >
            {{ savingSpend ? $t('common.loading') : $t('common.save') }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="showForm" class="card p-4 mb-4">
      <h2 class="font-medium text-slate-900 mb-3">{{ $t('campaigns.add') }}</h2>

      <div class="space-y-3">
        <div>
          <label for="c-name" class="field-label">{{ $t('campaigns.name') }}</label>
          <input id="c-name" v-model="newName" type="text" class="field-input" />
        </div>

        <div>
          <label for="c-channel" class="field-label">{{ $t('campaigns.channel') }}</label>
          <select id="c-channel" v-model="newChannel" class="field-input">
            <option v-for="s in LEAD_SOURCES" :key="s" :value="s">{{ $t(`source.${s}`) }}</option>
          </select>
        </div>

        <div>
          <label for="c-budget" class="field-label">
            {{ $t('campaigns.budget') }} (TZS)
            <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
          </label>
          <input
            id="c-budget"
            v-model="newBudget"
            type="text"
            inputmode="numeric"
            class="field-input tabular-nums"
            placeholder="1000000"
            :aria-invalid="newBudget.length > 0 && newBudgetMinor === null"
          />
          <p v-if="newBudget.length > 0 && newBudgetMinor === null" class="field-error">
            {{ $t('expenses.invalidAmount') }}
          </p>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-secondary flex-1" @click="showForm = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn-primary flex-1"
            :disabled="!canSaveCampaign"
            @click="saveCampaign"
          >
            {{ saving ? $t('common.loading') : $t('common.save') }}
          </button>
        </div>
      </div>
    </section>

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

      <div class="data-table-wrap">
        <table class="data-table min-w-[46rem]">
          <thead>
            <tr>
              <th>{{ $t('campaigns.campaign') }}</th>
              <th class="text-right">{{ $t('campaigns.spend') }}</th>
              <th class="text-right">{{ $t('campaigns.leads') }}</th>
              <th class="text-right">{{ $t('campaigns.cpl') }}</th>
              <th class="text-right">{{ $t('campaigns.won') }}</th>
              <th class="text-right">{{ $t('campaigns.cac') }}</th>
              <th class="text-right">{{ $t('campaigns.roas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pager.items.value" :key="row.key">
              <td>
                <p class="font-medium text-slate-900">{{ row.name }}</p>
                <p class="text-xs text-slate-500">
                  {{ $t(`source.${row.channel}`) }}
                  <span v-if="row.spentNothingReturned" class="ml-1 text-rose-700 font-medium">
                    · {{ $t('campaigns.noLeads') }}
                  </span>
                </p>
              </td>
              <td class="num">{{ formatMoney(row.spendMinor, 'TZS', { compact: true }) }}</td>
              <td class="num">{{ row.leads }}</td>
              <td class="num">{{ formatMoney(row.cplMinor, 'TZS', { compact: true }) }}</td>
              <td class="num">{{ row.won }}</td>
              <td class="text-right">
                <MetricValue
                  :value="row.value"
                  :n="row.n"
                  :low-confidence="row.lowConfidence"
                  money
                />
              </td>
              <td class="num">{{ row.roas === null ? '—' : `${row.roas.toFixed(2)}×` }}</td>
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
