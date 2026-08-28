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
import { priorityScore } from '@/domain/scoring.js'
import { BOARD_ORDER } from '@/domain/stages.js'
import { normalizePhone, formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { formatMoney } from '@/domain/money.js'
import { toDate } from '@/domain/periods.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
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

/** Owners actually present in what's loaded so far — only meaningful once names resolve. */
const ownerOptions = computed(() => {
  if (!canSeeOtherOwners.value) return []
  const ids = new Set(items.value.map((l) => l.ownerId).filter(Boolean))
  return [...ids]
    .map((id) => ({ id, name: nameFor(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  // Let an agent paste or type a phone number and find the lead — the most common way
  // they identify someone who has just rung them.
  const asPhone = term ? normalizePhone(term) : null

  return [...items.value]
    .filter((lead) => {
      if (!showClosed.value && lead.leadStatus !== 'open') return false
      if (stageFilter.value && lead.stage !== stageFilter.value) return false
      if (ownerFilter.value && lead.ownerId !== ownerFilter.value) return false
      if (!term) return true
      const name = (lead.displayName ?? '').toLowerCase()
      const phone = lead.primaryPhoneNormalized ?? ''
      return (
        name.includes(term) ||
        phone.includes(term.replace(/\D/g, '')) ||
        (asPhone !== null && phone === asPhone)
      )
    })
    .sort((a, b) => priorityScore(b, now.value) - priorityScore(a, now.value))
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
watch([search, stageFilter, ownerFilter, showClosed], () => pager.reset())

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

      <!-- Only worth showing to a role that sees more than their own leads; an agent's
           "owner" is always themselves. Filters over what's loaded so far — Load more
           (below) brings more into view if the person isn't in the list yet. -->
      <div v-if="canSeeOtherOwners &amp;&amp; ownerOptions.length">
        <label for="lead-owner" class="sr-only">{{ $t('leads.owner') }}</label>
        <select id="lead-owner" v-model="ownerFilter" class="field-input">
          <option value="">{{ $t('leads.allOwners') }}</option>
          <option v-for="o in ownerOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
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
      <div class="data-table-wrap">
        <table class="data-table min-w-[52rem]">
          <thead>
            <tr>
              <th>{{ $t('leads.name') }}</th>
              <th>{{ $t('leads.event') }}</th>
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
                  class="font-medium text-slate-900 hover:text-brand-700"
                >
                  {{ lead.displayName || $t('lead.unnamed') }}
                </RouterLink>
              </td>
              <td>
                <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" compact />
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
