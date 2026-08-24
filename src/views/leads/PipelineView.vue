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
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { useCollection } from '@/composables/useCollection.js'
import { leadsQuery } from '@/services/queries.js'
import { changeStage } from '@/services/leads.service.js'
import { BOARD_ORDER, validateTransition, canTransition, nextStages } from '@/domain/stages.js'
import { formatMoney } from '@/domain/money.js'
import { priorityScore } from '@/domain/scoring.js'
import PageHeader from '@/components/layout/PageHeader.vue'
import EventCountdown from '@/components/leads/EventCountdown.vue'
import LoadingRows from '@/components/ui/LoadingRows.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ShowMoreButton from '@/components/ui/ShowMoreButton.vue'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const user = computed(() => ({
  uid: auth.uid, role: auth.role, orgId: auth.orgId, teamId: auth.teamId,
}))

const { items, loading, loaded, error, load } = useCollection(
  () => leadsQuery(user.value, { max: 200 }),
)

/**
 * How many cards a column shows before asking. Eight columns × 12 keeps the board scannable
 * on a laptop; the cut is by `priorityScore`, so what is hidden is by definition the least
 * urgent work in that stage.
 */
const COLUMN_PAGE = 12

// Per-stage, so revealing `contacted` leaves `quoted` exactly as it was. All 200 leads are
// already in memory from the single query — this is a rendering cap, not another read.
const revealed = reactive(Object.fromEntries(BOARD_ORDER.map((stage) => [stage, COLUMN_PAGE])))

const columns = computed(() =>
  BOARD_ORDER.map((stage) => {
    const leads = items.value
      .filter((l) => l.stage === stage)
      .sort((a, b) => priorityScore(b) - priorityScore(a))
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

/** Highlight only the columns this lead may legally move to (§5.2). */
const legalTargets = computed(() => {
  const lead = dragging.value ?? moveTarget.value
  return lead ? nextStages(lead.stage) : []
})

async function moveTo(lead, stage) {
  dragging.value = null
  moveTarget.value = null
  if (!lead || lead.stage === stage) return

  const check = validateTransition(lead, stage)
  if (!check.ok) {
    // A sentence the user can act on — "Fill in lossReason before moving to lost" — not a
    // permission error. Stages needing extra fields are completed on the lead detail screen.
    ui.warn(check.message || t('pipeline.cannotMove'))
    return
  }

  try {
    await changeStage({
      lead,
      toStage: stage,
      user: { uid: auth.uid, displayName: auth.displayName },
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
          class="w-64 shrink-0 rounded-xl bg-slate-100/70 p-2 transition-colors"
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

          <div class="space-y-2">
            <article
              v-for="lead in column.leads"
              :key="lead.id"
              class="card p-3 cursor-grab active:cursor-grabbing"
              draggable="true"
              @dragstart="dragging = lead"
              @dragend="dragging = null"
            >
              <RouterLink
                :to="{ name: 'lead-detail', params: { id: lead.id } }"
                class="block text-sm font-medium text-slate-900 hover:text-brand-700 truncate"
              >
                {{ lead.displayName || $t('lead.unnamed') }}
              </RouterLink>

              <div class="mt-1">
                <EventCountdown :event-date="lead.eventDate" compact />
              </div>

              <p v-if="lead.dealValueMinor" class="mt-1 text-xs text-slate-600 tabular-nums">
                {{ formatMoney(lead.dealValueMinor, lead.currency) }}
              </p>

              <!-- Touch path: dragging a card on a phone fights the scroll container. -->
              <button
                v-if="nextStages(lead.stage).length"
                type="button"
                class="mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-medium text-brand-700
                       ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                @click="moveTarget = lead"
              >
                {{ $t('pipeline.move') }}
              </button>
            </article>

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
