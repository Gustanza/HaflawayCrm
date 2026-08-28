<script setup>
/**
 * Expenses — TODO.md §12 screen 10, the append-only ledger (P4).
 *
 * The two things this screen must make unmistakable:
 *   1. Entries CANNOT be edited or deleted. A correction is a new, negative entry that
 *      references the one it corrects. The rules enforce it; the UI says why, so nobody
 *      files a bug about the missing edit button.
 *   2. Every entry carries an ALLOCATION (§9) — campaign, staff, team or overhead. That
 *      single field is what makes CAC-per-staff computable at all, so it is required, not
 *      an afterthought at the bottom of the form.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { expensesQuery, campaignOptionsQuery } from '@/services/queries.js'
import { formatMoney, toMinor } from '@/domain/money.js'
import { periodKeys } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items, loading, loaded, error, load } = useCollection(
  () => expensesQuery(user.value, { max: 200 }),
)
const { items: campaigns } = useCollection(() => campaignOptionsQuery(user.value))

const CATEGORIES = [
  'ad_spend', 'salary', 'commission', 'airtime', 'data', 'transport', 'tools', 'rent', 'other',
]
const ALLOCATION_TYPES = ['campaign', 'staff', 'team', 'overhead']

const showForm = ref(false)
const category = ref('ad_spend')
const amount = ref('')
const description = ref('')
const allocationType = ref('campaign')
const allocationCampaign = ref('')
const allocationStaff = ref('')
const saving = ref(false)

const amountMinor = computed(() => toMinor(amount.value))
const amountValid = computed(() => amountMinor.value !== null && amountMinor.value !== 0)

const allocationValid = computed(() => {
  if (allocationType.value === 'campaign') return Boolean(allocationCampaign.value)
  if (allocationType.value === 'staff') return Boolean(allocationStaff.value.trim())
  return true
})

const canSave = computed(() => amountValid.value && allocationValid.value && !saving.value)

/** Newest first, flat — this is what gets paginated. */
const ordered = computed(() =>
  [...items.value].sort((a, b) => {
    const byMonth = (b.monthKey ?? '').localeCompare(a.monthKey ?? '')
    if (byMonth !== 0) return byMonth
    return (b.incurredOn?.seconds ?? 0) - (a.incurredOn?.seconds ?? 0)
  }),
)

const pager = usePagination(ordered, { pageSize: 25 })

/**
 * Group the VISIBLE PAGE by month, not the whole set.
 *
 * Grouping first and paging the groups gives wildly uneven pages — a single month easily
 * holds forty entries — so the month headings here describe the current page only. The
 * per-month total is likewise the page's total, and says so.
 */
const grouped = computed(() => {
  const byMonth = new Map()
  for (const expense of pager.items.value) {
    const key = expense.monthKey ?? '—'
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(expense)
  }
  return [...byMonth.entries()].map(([monthKey, expenses]) => ({
    monthKey,
    expenses,
    totalMinor: expenses.reduce((total, e) => total + (e.amountMinor ?? 0), 0),
  }))
})

/** The real total across everything loaded — not just what is on screen. */
const grandTotalMinor = computed(() =>
  items.value.reduce((total, e) => total + (e.amountMinor ?? 0), 0),
)

async function save() {
  if (!canSave.value) return
  saving.value = true

  const now = new Date()
  const allocation = { type: allocationType.value }
  if (allocationType.value === 'campaign') allocation.campaignId = allocationCampaign.value
  if (allocationType.value === 'staff') allocation.staffId = allocationStaff.value.trim()
  if (allocationType.value === 'team') allocation.teamId = auth.teamId

  try {
    const db = await getDb()
    await addDoc(collection(db, 'expenses'), {
      orgId: auth.orgId,
      category: category.value,
      amountMinor: amountMinor.value,
      currency: 'TZS',
      incurredOn: now,
      ...periodKeys(now),
      allocation,
      description: description.value.trim(),
      isRecurring: false,
      enteredBy: auth.uid,
      createdAt: serverTimestamp(),
      createdBy: auth.uid,
    })
    ui.success(t('expenses.saved'))
    amount.value = ''
    description.value = ''
    showForm.value = false
    load()
  } catch {
    ui.error(t('errors.write.permissionDenied'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.expenses')">
      <template #subtitle>
        {{ $t('expenses.subtitle') }}
        <span v-if="items.length" class="tabular-nums">
          · {{ $t('expenses.grandTotal', { amount: formatMoney(grandTotalMinor) }) }}
        </span>
      </template>
      <template v-if="auth.can.editCosts" #actions>
        <button type="button" class="btn-primary text-sm" @click="showForm = !showForm">
          + {{ $t('expenses.add') }}
        </button>
      </template>
    </PageHeader>

    <div class="px-4 sm:px-6 py-4 sm:py-6">

    <!-- P4, stated where it matters rather than buried in a doc. -->
    <div class="mb-4 rounded-lg bg-slate-100 ring-1 ring-slate-300 p-3">
      <p class="text-sm font-medium text-slate-800">{{ $t('expenses.appendOnlyTitle') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ $t('expenses.appendOnlyBody') }}</p>
    </div>

    <section v-if="showForm" class="card p-4 mb-4">
      <h2 class="font-medium text-slate-900 mb-3">{{ $t('expenses.add') }}</h2>

      <div class="space-y-3">
        <div>
          <label for="e-amount" class="field-label">{{ $t('expenses.amount') }} (TZS)</label>
          <input
            id="e-amount"
            v-model="amount"
            type="text"
            inputmode="numeric"
            class="field-input tabular-nums"
            placeholder="150000"
            :aria-invalid="amount.length > 0 && !amountValid"
          />
          <p v-if="amount.length > 0 && !amountValid" class="field-error">
            {{ $t('expenses.invalidAmount') }}
          </p>
          <p v-else-if="amountMinor !== null" class="mt-1.5 text-sm text-slate-500">
            {{ formatMoney(amountMinor) }}
          </p>
        </div>

        <div>
          <label for="e-category" class="field-label">{{ $t('expenses.category') }}</label>
          <select id="e-category" v-model="category" class="field-input">
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ $t(`expenseCategory.${c}`) }}</option>
          </select>
        </div>

        <!-- §9: the allocation is what makes CAC-per-anything possible. Required. -->
        <fieldset>
          <legend class="field-label">{{ $t('expenses.allocation') }}</legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="type in ALLOCATION_TYPES"
              :key="type"
              type="button"
              class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                     bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                     data-[on=true]:ring-brand-600"
              style="min-height: var(--spacing-touch)"
              :data-on="allocationType === type"
              @click="allocationType = type"
            >
              {{ $t(`allocation.${type}`) }}
            </button>
          </div>
          <p class="mt-1.5 text-xs text-slate-500">{{ $t('expenses.allocationHelp') }}</p>
        </fieldset>

        <div v-if="allocationType === 'campaign'">
          <label for="e-campaign" class="field-label">{{ $t('campaigns.campaign') }}</label>
          <select id="e-campaign" v-model="allocationCampaign" class="field-input">
            <option value="">{{ $t('detail.choose') }}</option>
            <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>

        <div v-if="allocationType === 'staff'">
          <label for="e-staff" class="field-label">{{ $t('expenses.staffId') }}</label>
          <input id="e-staff" v-model="allocationStaff" type="text" class="field-input"
                 placeholder="u-agent-1" />
        </div>

        <div>
          <label for="e-desc" class="field-label">
            {{ $t('expenses.description') }}
            <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
          </label>
          <input id="e-desc" v-model="description" type="text" class="field-input" />
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-secondary flex-1" @click="showForm = false">
            {{ $t('common.cancel') }}
          </button>
          <button type="button" class="btn-primary flex-1" :disabled="!canSave" @click="save">
            {{ saving ? $t('common.loading') : $t('common.save') }}
          </button>
        </div>
      </div>
    </section>

    <LoadingRows v-if="loading && !loaded" :rows="5" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <EmptyState
      v-else-if="loaded && !items.length"
      :title="$t('expenses.none')"
      :body="$t('expenses.noneBody')"
    />

    <template v-else>
      <div class="space-y-5">
      <section v-for="group in grouped" :key="group.monthKey">
        <h2 class="mb-2 flex items-baseline justify-between text-sm font-semibold text-slate-800">
          <span>{{ group.monthKey }}</span>
          <span class="tabular-nums text-slate-600">{{ formatMoney(group.totalMinor) }}</span>
        </h2>

        <div class="data-table-wrap">
          <table class="data-table min-w-[40rem]">
            <thead>
              <tr>
                <th>{{ $t('expenses.category') }}</th>
                <th>{{ $t('expenses.description') }}</th>
                <th>{{ $t('expenses.allocation') }}</th>
                <th class="text-right">{{ $t('expenses.amount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="expense in group.expenses" :key="expense.id">
                <td class="font-medium text-slate-900">
                  {{ $t(`expenseCategory.${expense.category}`) }}
                </td>
                <td class="text-slate-500">{{ expense.description || '—' }}</td>
                <td class="text-slate-500">
                  {{ $t(`allocation.${expense.allocation?.type ?? 'overhead'}`) }}
                  <template v-if="expense.allocation?.staffId">
                    · {{ expense.allocation.staffId }}
                  </template>
                </td>
                <td
                  class="num font-medium"
                  :class="expense.amountMinor < 0 ? 'text-emerald-700' : ''"
                >
                  {{ formatMoney(expense.amountMinor, expense.currency) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
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
    </template>
    </div>
  </div>
</template>
