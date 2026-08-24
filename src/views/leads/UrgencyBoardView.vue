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
import { urgencyBoardQuery } from '@/services/queries.js'
import { daysToEvent } from '@/domain/periods.js'
import { urgencyBand } from '@/domain/scoring.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import LeadRow from '@/components/leads/LeadRow.vue'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePagination } from '@/composables/usePagination.js'
import PaginationBar from '@/components/ui/PaginationBar.vue'

const auth = useAuthStore()
const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items, loading, loaded, error, load } = useCollection(
  () => urgencyBoardQuery(user.value, { max: 100 }),
)

const logTarget = ref(null)

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
    const da = daysToEvent(a.eventDate)
    const db = daysToEvent(b.eventDate)
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }),
)

/**
 * A pager per band id, created once so page position survives a re-render.
 *
 * MUST come after `sorted`. `usePagination` watches its source to keep the current page in
 * range, and `watch` evaluates the source immediately on setup — so declaring these above
 * `sorted` reached a `const` in its temporal dead zone and threw at mount. The screen went
 * blank, and it compiled perfectly on the way there.
 */
const bandLeads = Object.fromEntries(
  BANDS.map((band) => [
    band.id,
    computed(() => sorted.value.filter((l) => urgencyBand(daysToEvent(l.eventDate)) === band.id)),
  ]),
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
        <div class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3 items-start">
          <LeadRow
            v-for="lead in group.shown"
            :key="lead.id"
            :lead="lead"
            :show-owner="auth.can.viewAllLeads || auth.can.viewTeamLeads"
            @log="logTarget = $event"
          />
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

    </div>

    <LogActivityDialog v-if="logTarget" :lead="logTarget" @close="logTarget = null" />
  </div>
</template>
