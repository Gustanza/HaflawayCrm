<script setup>
/**
 * Pipeline board — TODO.md §12 screen 6.
 *
 * Drag-and-drop on a pointer device, and a tap-to-move sheet on touch. Both go through
 * `validateTransition` FIRST (§5.2), so an illegal move gives a sentence the user can act
 * on instead of an opaque permission error bouncing back off the rules.
 *
 * Columns carry a count AND a summed value, because "12 leads in quoted" and "TZS 4.2m in
 * quoted" are different questions and a manager asks the second one.
 *
 * A busy column holds 80 cards, which turns the board into an infinite vertical scroll and
 * defeats the point of seeing eight stages at once. So each column renders a capped, ranked
 * slice and reveals the rest on request — but the header count and the summed value are
 * ALWAYS computed over the whole column. Those two numbers are what a manager reads to judge
 * the pipeline; printing "12" over 80 leads would be a lie, and a quietly shrunken total is
 * worse than a long column.
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { useNow } from '@/composables/useNow.js'
import { useStageMessage } from '@/composables/useStageMessage.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { leadsQuery } from '@/services/queries.js'
import { changeStage } from '@/services/leads.service.js'
import { BOARD_ORDER, validateTransition, canTransition, nextStages } from '@/domain/stages.js'
import { formatMoney } from '@/domain/money.js'
import { priorityScore, followUpBucket } from '@/domain/scoring.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import NextActionCountdown from '@/components/leads/NextActionCountdown.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ShowMoreButton from '@/components/ui/ShowMoreButton.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { messageFor, isFixable } = useStageMessage()
const { t } = useI18n()

const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const canSeeOtherOwners = computed(() => auth.can.viewAllLeads || auth.can.viewTeamLeads)

// Must match the `max` given to leadsQuery() below — see the identical note in
// LeadListView.vue. `order` makes which leads get fetched deterministic; the per-stage
// priorityScore sort further down still decides ordering WITHIN a column.
const BOARD_PAGE_SIZE = 200
const { items, loading, loadingMore, loaded, error, load, loadMore, hasMore } = useCollection(
  (after) =>
    leadsQuery(user.value, {
      max: BOARD_PAGE_SIZE,
      after,
      order: { field: 'updatedAt', direction: 'desc' },
    }),
  { pageSize: BOARD_PAGE_SIZE },
)

const { nameFor } = useUserNames(() => (canSeeOtherOwners.value ? auth.orgId : null))

// Ticks on its own — see useNow.js. Without it, a card's priorityScore (and therefore its
// position in the column) is frozen at whatever it was when this view last re-rendered.
const now = useNow()

/**
 * How many cards a column shows before asking. Eleven columns × 12 keeps the board scannable
 * on a laptop; the cut is by `priorityScore`, so what is hidden is by definition the least
 * urgent work in that stage.
 */
const COLUMN_PAGE = 12

// Per-stage, so revealing `contacted` leaves `quoted` exactly as it was. All 200 leads are
// already in memory from the single query — this is a rendering cap, not another read.
const revealed = reactive(Object.fromEntries(BOARD_ORDER.map((stage) => [stage, COLUMN_PAGE])))

/**
 * One pass over `items`, not eleven. This used to be
 * `BOARD_ORDER.map(stage => items.value.filter(l => l.stage === stage).sort(...))` — every
 * one of the 11 stages re-scanned the WHOLE fetched set to pull out its own handful of
 * leads, on every recompute (which now includes every useNow() tick, not just data
 * changes). Grouping once is the same O(n) work `.filter()` alone would have cost for a
 * SINGLE stage, with all 11 stages coming out of it instead of just one.
 */
const byStage = computed(() => {
  const groups = new Map(BOARD_ORDER.map((stage) => [stage, []]))
  for (const lead of items.value) {
    groups.get(lead.stage)?.push(lead)
  }
  for (const leads of groups.values()) {
    leads.sort((a, b) => priorityScore(b, now.value) - priorityScore(a, now.value))
  }
  return groups
})

const columns = computed(() =>
  BOARD_ORDER.map((stage) => {
    const leads = byStage.value.get(stage) ?? []
    const cap = revealed[stage]
    return {
      stage,
      // The whole column, always — never the visible slice.
      total: leads.length,
      valueMinor: leads.reduce((sum, l) => sum + (l.dealValueMinor ?? 0), 0),
      leads: leads.slice(0, cap),
      remaining: Math.max(0, leads.length - cap),
      expanded: cap > COLUMN_PAGE && leads.length > COLUMN_PAGE,
    }
  }),
)

const revealMore = (stage) => {
  revealed[stage] += COLUMN_PAGE
}
const collapseColumn = (stage) => {
  revealed[stage] = COLUMN_PAGE
}

const isEmpty = computed(() => loaded.value && items.value.length === 0)

/* ------------------------------------------------------------------ moving */

const dragging = ref(null)
const moveTarget = ref(null)

/**
 * A card is too small for a second countdown, so the board shows only the ALARM: a deal
 * whose promised callback has already passed. That is the one thing a manager scanning
 * eight columns needs to spot — a card sitting in "Negotiating" that nobody has rung back
 * is how a deal dies quietly. Everything else about the follow-up clock stays on the
 * screens that have room for it.
 */
function followUpOverdue(lead) {
  return followUpBucket(lead.nextActionAt, now.value) === 'overdue'
}

/**
 * Where the dragged lead may land.
 *
 * This used to be `nextStages()` — the handful of columns the old funnel permitted — and
 * the highlight carried real information because most columns were refused. Every column
 * is reachable now, so highlighting "legal" ones would ring the entire board and say
 * nothing. What is still worth showing is the one exception: an agent cannot pull a lead
 * OUT of a closed stage, so for them a closed lead lights up nothing and the board says
 * so rather than accepting the drop and failing afterwards.
 */
const legalTargets = computed(() => {
  const lead = dragging.value ?? moveTarget.value
  if (!lead) return []
  return nextStages(lead.stage).filter(
    (to) => validateTransition({ ...lead, stage: lead.stage }, to, { role: auth.role }).code
      !== 'REOPEN_FORBIDDEN',
  )
})

async function moveTo(lead, stage) {
  dragging.value = null
  moveTarget.value = null
  if (!lead || lead.stage === stage) return

  const check = validateTransition(lead, stage, { role: auth.role })
  if (!check.ok) {
    ui.warn(messageFor(check, stage))
    /**
     * "Add the deal value before moving to Won" was true and useless: there is nowhere
     * on a kanban board to add one, so the board named a form the user could not reach
     * and then dropped them back where they started. When the block is something a
     * form can clear, take them to the form with the target stage already selected.
     */
    if (isFixable(check)) {
      router.push({ name: 'lead-detail', params: { id: lead.id }, query: { stage } })
    }
    return
  }

  try {
    await changeStage({
      lead,
      toStage: stage,
      // The role is what permits reopening a closed lead. Omitting it made
      // changeStage re-validate as an anonymous caller and refuse the very move this
      // screen had just approved — the board said yes, the service said no.
      user: { uid: auth.uid, displayName: auth.displayName, role: auth.role },
    })
    ui.success(t('detail.stageChanged', { stage: t(`stage.${stage}`) }))
    load()
  } catch (err) {
    ui.error(err.message ?? t('errors.write.generic'))
  }
}

function onDrop(stage) {
  if (dragging.value) moveTo(dragging.value, stage)
}
</script>

<template>
  <div>
    <PageHeader :title="$t('nav.pipeline')" :subtitle="$t('pipeline.subtitle')" />

    <div class="px-4 sm:px-6 py-4 sm:py-6">
    <LoadingRows v-if="loading && !loaded" :rows="4" />

    <div v-else-if="error" class="card p-6 text-center">
      <p class="text-sm text-slate-700">{{ $t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="load">{{ $t('common.retry') }}</button>
    </div>

    <EmptyState v-else-if="isEmpty" :title="$t('leads.none')" :body="$t('leads.noneBody')" />

    <!-- Horizontal scroll is confined to this container; the page body never scrolls
         sideways (§15). -->
    <div v-else class="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-4">
      <div class="flex gap-3 min-w-max">
        <section
          v-for="column in columns"
          :key="column.stage"
          class="w-72 shrink-0 rounded-xl bg-slate-100/70 p-2 transition-colors"
          :class="
            legalTargets.includes(column.stage)
              ? 'ring-2 ring-brand-500 bg-brand-50'
              : dragging && column.stage !== dragging.stage
                ? 'opacity-50'
                : ''
          "
          :aria-labelledby="`col-${column.stage}`"
          @dragover.prevent
          @drop.prevent="onDrop(column.stage)"
        >
          <header class="px-2 py-2">
            <h2 :id="`col-${column.stage}`" class="text-sm font-semibold text-slate-800">
              {{ $t(`stage.${column.stage}`) }}
              <!-- The whole column, not the visible slice — a manager judges the pipeline
                   off this number. -->
              <span class="ml-1 font-normal text-slate-500">{{ column.total }}</span>
            </h2>
            <p v-if="column.valueMinor" class="text-xs text-slate-500 tabular-nums">
              {{ formatMoney(column.valueMinor, 'TZS', { compact: true }) }}
            </p>
          </header>

          <!--
            CARDS, NOT TABLE ROWS.

            This column was a `.data-table` with its own `<thead>`, and that header was the
            whole problem: "Deal value" reserved width for the WORDS, not for the values,
            on a 288px column where most values are blank. The name cell was left on
            `max-w-0` and everything inside it wrapped — a date countdown broken across
            three lines, an overdue pill across two. The countdown also inherited `text-sm`
            against the table's `text-xs`, so the least important thing on the card was the
            largest. And a bare `<tr>` gives a dragging hand nothing to aim at.

            A kanban card is a card. It sizes to its own content, needs no repeated column
            headers, and looks grabbable.
          -->
          <ul v-if="column.leads.length" class="space-y-2">
            <li
              v-for="lead in column.leads"
              :key="lead.id"
              class="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200 transition
                     cursor-grab hover:ring-slate-300 active:cursor-grabbing"
              :class="dragging && dragging.id === lead.id ? 'opacity-40' : ''"
              draggable="true"
              @dragstart="dragging = lead"
              @dragend="dragging = null"
            >
              <div class="flex items-start gap-1">
                <RouterLink
                  :to="{ name: 'lead-detail', params: { id: lead.id } }"
                  class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 hover:text-brand-700"
                >
                  {{ lead.displayName || $t('lead.unnamed') }}
                </RouterLink>

                <!-- Touch path: dragging a card on a phone fights the scroll container. -->
                <button
                  v-if="nextStages(lead.stage).length"
                  type="button"
                  class="icon-btn -mr-1 -mt-1 shrink-0"
                  :aria-label="`${$t('pipeline.move')} ${lead.displayName}`"
                  @click="moveTarget = lead"
                >
                  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>

              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <EventCountdown :event-date="lead.eventDate" compact />
                <NextActionCountdown v-if="followUpOverdue(lead)" :at="lead.nextActionAt" />
              </div>

              <!-- Only rendered when there is something to say. An em-dash in every deal
                   value slot is eight columns of visual noise carrying no information. -->
              <div
                v-if="lead.dealValueMinor || (canSeeOtherOwners && lead.ownerId)"
                class="mt-1.5 flex items-baseline gap-2 text-xs"
              >
                <span v-if="lead.dealValueMinor" class="font-medium tabular-nums text-slate-700">
                  {{ formatMoney(lead.dealValueMinor, lead.currency) }}
                </span>
                <span v-if="canSeeOtherOwners" class="ml-auto truncate text-slate-500">
                  {{ nameFor(lead.ownerId) }}
                </span>
              </div>
            </li>
          </ul>

          <div class="mt-2 space-y-2">
            <p v-if="!column.total" class="px-2 py-6 text-center text-xs text-slate-400">
              {{ $t('pipeline.emptyColumn') }}
            </p>

            <!-- Says plainly that this column is cut short, and by how much. -->
            <p
              v-if="column.remaining"
              class="px-2 pt-1 text-center text-xs text-slate-500 tabular-nums"
              role="status"
            >
              {{ $t('list.collapsed', { shown: column.leads.length, total: column.total }) }}
            </p>

            <ShowMoreButton :remaining="column.remaining" @more="revealMore(column.stage)" />

            <button
              v-if="column.expanded"
              type="button"
              class="w-full rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600
                     hover:bg-slate-200/70"
              @click="collapseColumn(column.stage)"
            >
              {{ $t('list.showLess') }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- Distinct from each column's own "show more": this fetches leads the board hasn't
         loaded from Firestore AT ALL yet, across every stage at once. -->
    <div v-if="hasMore" class="mt-3 text-center">
      <button type="button" class="btn-secondary" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? $t('common.loading') : $t('leads.loadMore') }}
      </button>
    </div>

    <!-- Tap-to-move sheet -->
    <div v-if="moveTarget" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-slate-900/50" aria-hidden="true" @click="moveTarget = null" />
      <div
        class="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4"
        style="padding-bottom: max(1rem, env(safe-area-inset-bottom))"
        role="dialog"
        aria-modal="true"
      >
        <h2 class="font-semibold text-slate-900 truncate">{{ moveTarget.displayName }}</h2>
        <p class="mt-0.5 mb-3 text-sm text-slate-500">{{ $t('detail.moveTo') }}</p>

        <div class="flex flex-wrap gap-2">
          <button
            v-for="stage in nextStages(moveTarget.stage)"
            :key="stage"
            type="button"
            class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                   bg-white text-slate-700 hover:bg-brand-50"
            style="min-height: var(--spacing-touch)"
            @click="moveTo(moveTarget, stage)"
          >
            {{ $t(`stage.${stage}`) }}
          </button>
        </div>

        <button type="button" class="btn-secondary w-full mt-4" @click="moveTarget = null">
          {{ $t('common.cancel') }}
        </button>
      </div>
    </div>
    </div>
  </div>
</template>
