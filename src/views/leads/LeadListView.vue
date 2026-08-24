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
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { leadsQuery } from '@/services/queries.js'
import { priorityScore } from '@/domain/scoring.js'
import { BOARD_ORDER } from '@/domain/stages.js'
import { normalizePhone } from '@/domain/phone.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LeadRow from '@/components/leads/LeadRow.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import { usePagination, PAGE_SIZES } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()

const user = computed(() => ({
  uid: auth.uid,
  role: auth.role,
  orgId: auth.orgId,
  teamId: auth.teamId,
}))

const { items, loading, loaded, error, load } = useCollection(
  () => leadsQuery(user.value, { max: 100 }),
  { live: false },
)

const search = ref('')
const stageFilter = ref('')
const showClosed = ref(false)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  // Let an agent paste or type a phone number and find the lead — the most common way
  // they identify someone who has just rung them.
  const asPhone = term ? normalizePhone(term) : null

  return [...items.value]
    .filter((lead) => {
      if (!showClosed.value && lead.leadStatus !== 'open') return false
      if (stageFilter.value && lead.stage !== stageFilter.value) return false
      if (!term) return true
      const name = (lead.displayName ?? '').toLowerCase()
      const phone = lead.primaryPhoneNormalized ?? ''
      return (
        name.includes(term) ||
        phone.includes(term.replace(/\D/g, '')) ||
        (asPhone !== null && phone === asPhone)
      )
    })
    .sort((a, b) => priorityScore(b) - priorityScore(a))
})

const stageCounts = computed(() => {
  const counts = {}
  for (const lead of items.value) {
    if (!showClosed.value && lead.leadStatus !== 'open') continue
    counts[lead.stage] = (counts[lead.stage] ?? 0) + 1
  }
  return counts
})

const visibleStages = computed(() => BOARD_ORDER.filter((s) => stageCounts.value[s] > 0))

const pager = usePagination(filtered, { pageSize: 25 })

// Any change to the filters must return the user to page 1, or they land on an empty
// page 7 of a 2-page result and conclude there is nothing there.
watch([search, stageFilter, showClosed], () => pager.reset())

const logTarget = ref(null)
</script>

<template>
  <div>
    <PageHeader
      :title="$t('nav.leads')"
      :subtitle="$t('leads.showing', { shown: filtered.length, total: items.length })"
    >
      <template v-if="auth.can.createLead" #actions>
        <RouterLink :to="{ name: 'lead-new' }" class="btn-primary text-sm">
          + {{ $t('nav.newLead') }}
        </RouterLink>
      </template>

      <!-- Search and the stage chips live in the header so they stay reachable while a
           long list scrolls — they are how you change what the list IS, not part of it. -->
      <template #toolbar>
        <div class="space-y-3">
      <div>
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

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full px-3.5 text-sm font-medium ring-1 ring-inset ring-slate-400
                 bg-white text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white
                 data-[on=true]:ring-slate-800"
          style="min-height: 2.25rem"
          :data-on="stageFilter === ''"
          @click="stageFilter = ''"
        >
          {{ $t('leads.all') }}
        </button>
        <button
          v-for="stage in visibleStages"
          :key="stage"
          type="button"
          class="rounded-full px-3.5 text-sm font-medium ring-1 ring-inset ring-slate-400
                 bg-white text-slate-700 data-[on=true]:bg-slate-800 data-[on=true]:text-white
                 data-[on=true]:ring-slate-800"
          style="min-height: 2.25rem"
          :data-on="stageFilter === stage"
          @click="stageFilter = stageFilter === stage ? '' : stage"
        >
          {{ $t(`stage.${stage}`) }}
          <span class="ml-1 opacity-70">{{ stageCounts[stage] }}</span>
        </button>
      </div>

      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input v-model="showClosed" type="checkbox" class="size-4 rounded border-slate-400" />
        {{ $t('leads.showClosed') }}
      </label>
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
      <button type="button" class="btn-secondary" @click="search = ''; stageFilter = ''">
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
      <div class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3 items-start">
        <LeadRow
          v-for="lead in pager.items.value"
          :key="lead.id"
          :lead="lead"
          :show-owner="auth.can.viewAllLeads || auth.can.viewTeamLeads"
          @log="logTarget = $event"
        />
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

    <LogActivityDialog v-if="logTarget" :lead="logTarget" @close="logTarget = null" />
  </div>
</template>
