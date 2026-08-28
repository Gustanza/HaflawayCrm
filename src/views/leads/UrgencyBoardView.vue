<script setup>
/**
 * Urgency board — TODO.md §12 screen 7, and the clearest expression of P2.
 *
 * Open leads sorted purely by event date, banded by how close the event is. This is the
 * screen a generic CRM cannot give you: it ignores how enthusiastic anyone sounded and
 * asks only "whose window is closing first".
 *
 * WHY ONE PAGINATOR PER BAND, NOT ONE FOR THE SCREEN
 * -------------------------------------------------
 * Same argument as the Work Queue, only sharper here. The bands ARE the ranking, and
 * within a band the sort is event date ascending — the lead whose wedding is on Saturday
 * sits at the top of "This week". Paginating across that would mean the second page of
 * "This week" is the part of this week you care about least, reached by a control that
 * implies you ought to go there. Worse, a single pager over six bands would have to slice
 * across band boundaries or reset the whole board on every page turn.
 *
 * So: each band caps its own rows and reveals the rest on demand, independently. Opening
 * "Within a month" must not re-collapse "This week", because those are two different
 * questions the user is answering at two different moments.
 *
 * WHY 10, AND WHY ONE TAP REVEALS THE REST
 * -----------------------------------------
 * Ten rows is about a screen and a half on a 360px phone, and six bands means the default
 * board is bounded at 60 rows rather than the query's 100. `list.showMore` reads "Show
 * {count} more", so revealing exactly {count} keeps the button honest; revealing a further
 * 10 would not. One tap rather than three is P7. `list.showLess` re-collapses.
 *
 * The count beside each band heading is always the band's TRUE total, never the number of
 * rows currently rendered — a band that says 3 when 18 events are closing would be worse
 * than no board at all.
 */
import { computed, reactive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useCollection } from '@/composables/useCollection.js'
import { useNow } from '@/composables/useNow.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { urgencyBoardQuery } from '@/services/queries.js'
import { daysToEvent } from '@/domain/periods.js'
import { urgencyBand } from '@/domain/scoring.js'
import { formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import StageBadge from '@/components/leads/StageBadge.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const { t } = useI18n()
const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const canSeeOtherOwners = computed(() => auth.can.viewAllLeads || auth.can.viewTeamLeads)

// Must match `max` below. urgencyBoardQuery already orders by eventDate ascending and is
// already fully indexed for every role — unlike List/Pipeline/WorkQueue this needed no new
// composite index to support cursor pagination.
const BOARD_FETCH_SIZE = 100
const { items, loading, loadingMore, loaded, error, load, loadMore, hasMore } = useCollection(
  (after) => urgencyBoardQuery(user.value, { max: BOARD_FETCH_SIZE, after }),
  { pageSize: BOARD_FETCH_SIZE },
)

const { nameFor } = useUserNames(() => (canSeeOtherOwners.value ? auth.orgId : null))

const logTarget = ref(null)

// Ticks on its own — see useNow.js. Without it, a lead sitting in "This week" stays there
// even after its event passes into "Passed", until unrelated data forces a re-render — the
// exact staleness P2 exists to prevent, on the screen that exists purely to show it.
const now = useNow()

const BANDS = [
  { id: 'critical', key: 'urgency.critical', ring: 'ring-[var(--color-urgent-critical)]' },
  { id: 'high', key: 'urgency.high', ring: 'ring-[var(--color-urgent-high)]' },
  { id: 'medium', key: 'urgency.medium', ring: 'ring-[var(--color-urgent-medium)]' },
  { id: 'low', key: 'urgency.low', ring: 'ring-[var(--color-urgent-low)]' },
  { id: 'unknown', key: 'urgency.unknown', ring: 'ring-slate-300' },
  { id: 'passed', key: 'urgency.passed', ring: 'ring-slate-300' },
]

/**
 * One paginator per band. A single pager across the six bands would have to slice ACROSS
 * band boundaries — page 2 straddling "This week" and "Within 2 weeks" — which destroys
 * the band as a unit of meaning. Bands stay independently addressable.
 */
const BAND_PAGE_SIZE = 10

/** Sorted by event date ascending; leads with no date fall to the end. */
const sorted = computed(() =>
  [...items.value].sort((a, b) => {
    const da = daysToEvent(a.eventDate, now.value)
    const db = daysToEvent(b.eventDate, now.value)
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }),
)

/**
 * One pass over `sorted` to bucket every lead into its band, instead of each of the 6
 * bands re-scanning the whole array with its own `.filter()` (same redundant pattern fixed
 * in PipelineView.vue's column grouping — see that file's comment for why it matters once
 * this recomputes on every useNow() tick, not just on data changes). `sorted`'s order is
 * preserved within each band's array, since `Map` iteration and array push both keep
 * insertion order.
 */
const bandLeadsMap = computed(() => {
  const groups = new Map(BANDS.map((band) => [band.id, []]))
  for (const lead of sorted.value) {
    const band = urgencyBand(daysToEvent(lead.eventDate, now.value))
    groups.get(band)?.push(lead)
  }
  return groups
})

/**
 * A pager per band id, created once so page position survives a re-render.
 *
 * MUST come after `bandLeadsMap`. `usePagination` watches its source to keep the current
 * page in range, and `watch` evaluates the source immediately on setup — so declaring these
 * above their source reached a `const` in its temporal dead zone and threw at mount. The
 * screen went blank, and it compiled perfectly on the way there.
 */
const bandLeads = Object.fromEntries(
  BANDS.map((band) => [band.id, computed(() => bandLeadsMap.value.get(band.id) ?? [])]),
)
const pagers = Object.fromEntries(
  BANDS.map((band) => [band.id, usePagination(bandLeads[band.id], { pageSize: BAND_PAGE_SIZE })]),
)

const grouped = computed(() =>
  BANDS.map((band) => {
    const pager = pagers[band.id]
    return {
      ...band,
      shown: pager.items.value,
      // What the heading renders. The whole band, never the current page.
      total: bandLeads[band.id].value.length,
      pager,
    }
  }).filter((g) => g.total > 0),
)

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
    <PageHeader :title="$t('nav.urgency')" :subtitle="$t('urgency.subtitle')" />

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="4" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <EmptyState
      v-else-if="loaded && !items.length"
      :title="$t('urgency.none')"
      :body="$t('urgency.noneBody')"
    />

    <div v-else class="space-y-6">
      <section v-for="group in grouped" :key="group.id" :aria-labelledby="`band-${group.id}`">
        <h2
          :id="`band-${group.id}`"
          class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"
        >
          <span class="size-3 rounded-full ring-4 ring-inset" :class="group.ring" aria-hidden="true" />
          {{ $t(group.key) }}
          <span class="text-slate-400 font-normal">{{ group.total }}</span>
        </h2>
        <div class="data-table-wrap">
          <table class="data-table min-w-[44rem]">
            <thead>
              <tr>
                <th>{{ $t('leads.name') }}</th>
                <th>{{ $t('leads.event') }}</th>
                <th>{{ $t('leads.stage') }}</th>
                <th v-if="canSeeOtherOwners">{{ $t('leads.owner') }}</th>
                <th>{{ $t('leads.phone') }}</th>
                <th class="text-right">{{ $t('leads.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lead in group.shown" :key="lead.id">
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

        <!-- The truncation notice sits next to the control that undoes it, not in the
             heading: the heading is this band's accessible name via aria-labelledby.
             btn-secondary already sets min-height: var(--spacing-touch), so both controls
             clear the 44px floor with no extra styling (P7). -->
        <PaginationBar
          v-if="group.pager.pageCount.value > 1"
          compact
          :page="group.pager.page.value"
          :page-count="group.pager.pageCount.value"
          :from="group.pager.from.value"
          :to="group.pager.to.value"
          :total="group.pager.total.value"
          :per-page="group.pager.perPage.value"
          :pages="group.pager.windowFor(1)"
          :has-prev="group.pager.hasPrev.value"
          :has-next="group.pager.hasNext.value"
          @prev="group.pager.prev"
          @next="group.pager.next"
          @go="group.pager.go"
        />
      </section>
    </div>

    <!-- Distinct from each band's own paginator: this fetches leads the board hasn't
         loaded from Firestore at all yet, not just reveals more of what's already here. -->
    <div v-if="hasMore" class="mt-3 text-center">
      <button type="button" class="btn-secondary" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? $t('common.loading') : $t('leads.loadMore') }}
      </button>
    </div>

    </div>

    <LogActivityDialog v-if="logTarget" :lead="logTarget" @close="logTarget = null" />
  </div>
</template>
