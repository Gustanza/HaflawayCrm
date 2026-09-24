<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useDashboardStore } from '@/stores/dashboard.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { PRODUCT_TYPES, LOST_REASONS } from '@/domain/taxonomies.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

const { t } = useI18n()
const auth = useAuthStore()
const dashboard = useDashboardStore()
const { nameFor } = useUserNames(() => auth.orgId)

onMounted(() => {
  dashboard.load()
})

/* ------------------------------------------------------------------ formatting */

const DAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Day keys are org-local calendar days; format them as UTC so the host zone cannot shift them. */
const fromDayKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const rangeLabel = computed(() => {
  const { start, end } = dashboard.range
  if (start === end) return DAY_FMT.format(fromDayKey(start))
  return `${DAY_FMT.format(fromDayKey(start))} – ${DAY_FMT.format(fromDayKey(end))}`
})

function formatDate(value) {
  const d = value?.toDate ? value.toDate() : value
  return d instanceof Date ? d.toLocaleDateString() : ''
}

function leadName(lead) {
  return lead.displayName || t('lead.unnamed')
}

const productList = (types) => types.map((p) => t(`productType.${p}`)).join(', ')

function eventLine(lead) {
  const type = lead.eventType ? t(`eventType.${lead.eventType}`) : null
  const date = lead.eventDate ? formatDate(lead.eventDate) : null
  if (type && date) return `${type} · ${date}`
  return type || date || t('dashboard.noEvent')
}

/* --------------------------------------------------------------- stat tiles */

const vs = computed(() => t(`dashboard.vs.${dashboard.period}`))

function change(key) {
  const cur = dashboard.current?.[key] ?? 0
  const prev = dashboard.previous?.[key] ?? 0
  const diff = cur - prev
  if (diff > 0) return t('dashboard.up', { count: diff, vs: vs.value })
  if (diff < 0) return t('dashboard.down', { count: -diff, vs: vs.value })
  return t('dashboard.flat', { vs: vs.value })
}

const tiles = computed(() => {
  const c = dashboard.current ?? {}
  return [
    { key: 'workedOn', value: c.workedOn ?? 0, label: t('dashboard.workedOn'), help: t('dashboard.workedOnHelp', { count: c.attempts ?? 0 }), tone: 'text-brand-800' },
    { key: 'reached', value: c.reached ?? 0, label: t('dashboard.reached'), help: t('dashboard.reachedHelp'), tone: 'text-sky-900' },
    { key: 'won', value: c.won ?? 0, label: t('dashboard.won'), help: t('dashboard.wonHelp', { count: c.wonClients ?? 0 }), tone: 'text-emerald-800' },
    { key: 'lost', value: c.lost ?? 0, label: t('dashboard.lost'), help: '', tone: 'text-rose-800' },
  ]
})

/* ---------------------------------------------------- speed to first contact */

/** "45 min" · "3 h" · "2 days" — rounded, because a stopwatch is not the point here. */
function formatDuration(ms) {
  if (ms == null) return '—'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return t('dashboard.durationMinutes', { count: Math.max(minutes, 1) })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('dashboard.durationHours', { count: hours })
  return t('dashboard.durationDays', { count: Math.round(hours / 24) })
}

/** Lower is better here, so the wording says faster/slower rather than ▲/▼. */
const speedChange = computed(() => {
  const cur = dashboard.speed?.current.avgMs
  const prev = dashboard.speed?.previous.avgMs
  if (cur == null || prev == null) return ''
  const diff = cur - prev
  if (Math.abs(diff) < 60000) return t('dashboard.flat', { vs: vs.value })
  return t(diff < 0 ? 'dashboard.fasterBy' : 'dashboard.slowerBy', { time: formatDuration(Math.abs(diff)), vs: vs.value })
})

/* -------------------------------------------------------------------- chart */

const chartMax = computed(() => Math.max(1, ...dashboard.series.map((b) => Math.max(b.workedOn, b.won))))

function barHeight(value) {
  if (!value) return '0%'
  return `${Math.max(3, Math.round((value / chartMax.value) * 100))}%`
}

function bucketTooltip(b) {
  return t('dashboard.bucketTooltip', { label: b.label, worked: b.workedOn, reached: b.reached, won: b.won })
}

/* ------------------------------------------------------------------- funnel */

const funnel = computed(() => {
  const c = dashboard.current ?? {}
  const steps = [
    { key: 'new', label: t('dashboard.funnelNew'), value: c.newLeads ?? 0, tone: 'text-slate-900', bar: 'bg-slate-700' },
    { key: 'worked', label: t('dashboard.funnelWorked'), value: c.workedOn ?? 0, tone: 'text-brand-800', bar: 'bg-brand-600' },
    { key: 'reached', label: t('dashboard.funnelReached'), value: c.reached ?? 0, tone: 'text-sky-900', bar: 'bg-sky-700' },
    { key: 'won', label: t('dashboard.funnelWon'), value: c.wonClients ?? 0, tone: 'text-emerald-800', bar: 'bg-emerald-600' },
  ]
  return steps.map((step, index) => {
    const prev = steps[index - 1]
    const rate = prev && prev.value > 0 && step.value <= prev.value
      ? Math.round((step.value / prev.value) * 100)
      : null
    return { ...step, rate, prevLabel: prev?.label ?? '' }
  })
})
const funnelMax = computed(() => Math.max(1, ...funnel.value.map((s) => s.value)))

/* --------------------------------------------------------------- breakdowns */

function rankedCounts(keys, counts) {
  return keys
    .map((key) => ({ key, count: counts?.[key] ?? 0 }))
    .sort((a, b) => b.count - a.count || keys.indexOf(a.key) - keys.indexOf(b.key))
}

const wonRows = computed(() => rankedCounts(PRODUCT_TYPES, dashboard.current?.wonByProduct))
const lostRows = computed(() => rankedCounts(LOST_REASONS, dashboard.current?.lostByReason))
const wonActive = computed(() => wonRows.value.filter((row) => row.count > 0))
const lostActive = computed(() => lostRows.value.filter((row) => row.count > 0))
const wonQuietLabel = computed(() =>
  wonRows.value.filter((row) => row.count === 0).map((row) => t(`productType.${row.key}`)).join(', '),
)
const lostQuietLabel = computed(() =>
  lostRows.value.filter((row) => row.count === 0).map((row) => t(`lossReason.${row.key}`)).join(', '),
)
const wonMax = computed(() => Math.max(1, ...wonActive.value.map((row) => row.count)))
const lostMax = computed(() => Math.max(1, ...lostActive.value.map((row) => row.count)))

const detailChosen = ref('')

const detailTabs = computed(() => [
  { key: 'pitch', label: t('dashboard.pitchShort'), count: dashboard.pitchList.length, idle: 'text-brand-800', selected: 'bg-brand-700 text-white ring-brand-700' },
  { key: 'people', label: t('dashboard.peopleShort'), count: dashboard.people.length, idle: 'text-slate-800', selected: 'bg-slate-800 text-white ring-slate-800' },
  { key: 'products', label: t('dashboard.productsShort'), count: dashboard.current?.won ?? 0, idle: 'text-brand-800', selected: 'bg-brand-700 text-white ring-brand-700' },
  { key: 'lost', label: t('dashboard.lost'), count: dashboard.current?.lost ?? 0, idle: 'text-rose-800', selected: 'bg-rose-800 text-white ring-rose-800' },
  { key: 'events', label: t('dashboard.eventsShort'), count: dashboard.upcomingEvents.length, idle: 'text-sky-900', selected: 'bg-sky-900 text-white ring-sky-900' },
  { key: 'hot', label: t('dashboard.hotShort'), count: dashboard.hotLeads.length, idle: 'text-amber-900', selected: 'bg-amber-800 text-white ring-amber-800' },
])

const detailKey = computed(() => {
  if (detailChosen.value && detailTabs.value.some((tab) => tab.key === detailChosen.value)) return detailChosen.value
  return detailTabs.value.find((tab) => tab.count > 0)?.key || 'deals'
})

function selectDetail(key) {
  detailChosen.value = key
}

function barWidth(count, max) {
  if (!count) return '0%'
  return `${Math.max(6, Math.round((count / max) * 100))}%`
}
</script>

<template>
  <div class="page-shell">
    <h1 class="page-title">{{ t('nav.dashboard') }}</h1>
    <p class="mt-1 text-sm text-slate-600">{{ rangeLabel }}</p>

    <div class="mt-5 flex flex-wrap gap-2" role="group" :aria-label="t('nav.dashboard')">
      <button
        v-for="p in dashboard.PERIODS"
        :key="p"
        type="button"
        class="cursor-pointer rounded-full px-4 text-sm font-medium ring-1 ring-inset transition-colors"
        style="min-height: var(--spacing-touch)"
        :class="dashboard.period === p
          ? 'bg-brand-700 text-white ring-brand-700'
          : 'bg-white text-slate-700 ring-slate-500 hover:bg-slate-50'"
        :aria-pressed="dashboard.period === p"
        @click="dashboard.setPeriod(p)"
      >
        {{ t(`dashboard.period.${p}`) }}
      </button>
    </div>

    <div
      v-if="dashboard.loading && !dashboard.loaded"
      class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="n in 4" :key="n" class="card rounded-2xl p-4">
        <div class="h-8 w-12 animate-pulse rounded bg-slate-200" />
        <div class="mt-3 h-3 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    </div>

    <div v-else-if="dashboard.error" class="card mt-6 px-6 py-10 text-center">
      <p class="text-sm font-medium text-rose-800">{{ t('errors.loadFailed') }}</p>
      <p v-if="dashboard.error.code === 'failed-precondition'" class="mt-1 text-sm text-slate-600">
        {{ t('dashboard.needsIndex') }}
      </p>
      <button type="button" class="btn-secondary mt-4" @click="dashboard.load()">
        {{ t('common.retry') }}
      </button>
    </div>

    <template v-else-if="dashboard.current">
      <!-- Headline numbers, each against the previous period -->
      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" :class="{ 'opacity-60': dashboard.loading }">
        <div v-for="tile in tiles" :key="tile.key" class="card rounded-2xl p-4">
          <p class="text-3xl font-semibold tabular-nums tracking-tight" :class="tile.tone">{{ tile.value }}</p>
          <p class="mt-1 text-sm font-medium text-slate-800">{{ tile.label }}</p>
          <p v-if="tile.help" class="text-xs text-slate-500">{{ tile.help }}</p>
          <p class="mt-2 text-xs font-medium tabular-nums text-slate-600">{{ change(tile.key) }}</p>
        </div>
      </div>

      <!-- Speed to first contact -->
      <section v-if="dashboard.speed" class="mt-6">
        <h2 class="section-label">{{ t('dashboard.firstContact') }}</h2>
        <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="card rounded-2xl p-4">
            <p class="text-3xl font-semibold tabular-nums tracking-tight text-sky-900">{{ dashboard.speed.waiting }}</p>
            <p class="mt-1 text-sm font-medium text-slate-800">{{ t('dashboard.waitingNow') }}</p>
            <p class="text-xs text-slate-500">{{ t('dashboard.waitingNowHelp') }}</p>
          </div>
          <div class="card rounded-2xl p-4">
            <p
              class="text-3xl font-semibold tabular-nums tracking-tight"
              :class="dashboard.speed.pastWindow ? 'text-rose-800' : 'text-slate-900'"
            >
              {{ dashboard.speed.pastWindow }}
            </p>
            <p class="mt-1 text-sm font-medium text-slate-800">{{ t('dashboard.pastWindow') }}</p>
            <p class="text-xs text-slate-500">{{ t('dashboard.pastWindowHelp') }}</p>
          </div>
          <div class="card rounded-2xl p-4">
            <p class="text-3xl font-semibold tabular-nums tracking-tight text-brand-800">
              {{ formatDuration(dashboard.speed.current.avgMs) }}
            </p>
            <p class="mt-1 text-sm font-medium text-slate-800">{{ t('dashboard.avgFirstContact') }}</p>
            <p class="text-xs text-slate-500">
              {{ t('dashboard.avgFirstContactHelp', { count: dashboard.speed.current.contacted }) }}
            </p>
            <p v-if="speedChange" class="mt-2 text-xs font-medium tabular-nums text-slate-600">{{ speedChange }}</p>
          </div>
        </div>
      </section>

      <!-- Progress through the period -->
      <section v-if="dashboard.hasChart" class="mt-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="section-label">{{ t('dashboard.progress') }}</h2>
          <div class="flex items-center gap-4 text-xs text-slate-600">
            <span class="flex items-center gap-1.5">
              <span class="size-2.5 rounded-sm" style="background: var(--color-brand-500)" aria-hidden="true" />
              {{ t('dashboard.legendWorkedOn') }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="size-2.5 rounded-sm bg-emerald-600" aria-hidden="true" />
              {{ t('dashboard.legendWon') }}
            </span>
          </div>
        </div>
        <div class="card mt-2 rounded-2xl p-4">
          <div class="flex h-44 items-end gap-2 border-b border-slate-200" aria-hidden="true">
            <div
              v-for="b in dashboard.series"
              :key="b.start"
              class="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
            >
              <div class="flex h-full w-1/2 max-w-7 flex-col justify-end">
                <span v-if="b.workedOn" class="mb-0.5 text-center text-[11px] tabular-nums text-slate-600">{{ b.workedOn }}</span>
                <div class="rounded-t" style="background: var(--color-brand-500)" :style="{ height: barHeight(b.workedOn) }" />
              </div>
              <div class="flex h-full w-1/2 max-w-7 flex-col justify-end">
                <span v-if="b.won" class="mb-0.5 text-center text-[11px] tabular-nums text-slate-600">{{ b.won }}</span>
                <div class="rounded-t bg-emerald-600" :style="{ height: barHeight(b.won) }" />
              </div>
              <div
                class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow group-hover:block"
              >
                {{ bucketTooltip(b) }}
              </div>
            </div>
          </div>
          <div class="mt-1.5 flex gap-2" aria-hidden="true">
            <span v-for="b in dashboard.series" :key="b.start" class="min-w-0 flex-1 truncate text-center text-xs text-slate-500">
              {{ b.label }}
            </span>
          </div>
          <table class="sr-only">
            <caption>{{ t('dashboard.progress') }}</caption>
            <thead>
              <tr><th scope="col" /><th scope="col">{{ t('dashboard.legendWorkedOn') }}</th><th scope="col">{{ t('dashboard.reached') }}</th><th scope="col">{{ t('dashboard.legendWon') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="b in dashboard.series" :key="b.start">
                <th scope="row">{{ b.label }}</th><td>{{ b.workedOn }}</td><td>{{ b.reached }}</td><td>{{ b.won }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Funnel: four figures, not a stack of hairline bars -->
      <section class="mt-6">
        <h2 class="section-label">{{ t('dashboard.funnel') }}</h2>
        <div class="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div v-for="step in funnel" :key="step.key" class="card rounded-2xl p-4">
            <p class="text-3xl font-semibold tabular-nums tracking-tight" :class="step.tone">{{ step.value }}</p>
            <p class="mt-1 text-sm font-medium text-slate-800">{{ step.label }}</p>
            <p v-if="step.rate != null" class="mt-0.5 text-xs text-slate-500">
              {{ t('dashboard.ofPrevious', { rate: step.rate, label: step.prevLabel }) }}
            </p>
            <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full" :class="step.bar" :style="{ width: barWidth(step.value, funnelMax) }" />
            </div>
          </div>
        </div>
      </section>

      <!-- One board. Counts stay in view; only the picked list opens. -->
      <section class="mt-6">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <RouterLink
            :to="{ name: 'deals-won' }"
            class="stat-chip text-slate-700"
          >
            <span class="text-xl font-semibold tabular-nums leading-none text-emerald-800">
              {{ dashboard.closedDeals.length }}
            </span>
            <span class="mt-1.5 text-xs font-medium leading-tight">{{ t('dashboard.closedDeals') }}</span>
          </RouterLink>
          <div class="contents" role="tablist" :aria-label="t('dashboard.detailLabel')">
          <button
            v-for="tab in detailTabs"
            :id="`detail-tab-${tab.key}`"
            :key="tab.key"
            type="button"
            role="tab"
            class="stat-chip cursor-pointer"
            :class="detailKey === tab.key ? tab.selected : tab.count ? 'text-slate-700' : 'text-slate-400'"
            :aria-selected="detailKey === tab.key"
            :aria-controls="`detail-panel-${tab.key}`"
            @click="selectDetail(tab.key)"
          >
            <span
              class="text-xl font-semibold tabular-nums leading-none"
              :class="detailKey === tab.key ? 'text-white' : tab.count ? tab.idle : 'text-slate-400'"
            >
              {{ tab.count }}
            </span>
            <span class="mt-1.5 text-xs font-medium leading-tight">{{ tab.label }}</span>
          </button>
          </div>
        </div>

        <div
          v-if="detailKey === 'pitch'"
          id="detail-panel-pitch"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-pitch"
        >
          <p class="mb-2 text-sm text-slate-600">{{ t('dashboard.pitchNextHelp') }}</p>
          <p v-if="!dashboard.pitchList.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noPitch') }}
          </p>
          <ul v-else class="space-y-2">
            <li v-for="row in dashboard.pitchList" :key="row.lead.id" class="lead-card">
              <RouterLink :to="{ name: 'lead-detail', params: { id: row.lead.id } }" class="block p-4">
                <div class="flex items-start justify-between gap-3">
                  <p class="min-w-0 truncate font-semibold text-slate-900">{{ leadName(row.lead) }}</p>
                  <span class="shrink-0 text-xs tabular-nums text-slate-500">{{ eventLine(row.lead) }}</span>
                </div>
                <p class="mt-1 text-sm text-slate-700">{{ t('dashboard.hasTaken', { products: productList(row.taken) }) }}</p>
                <p class="mt-0.5 text-sm font-medium text-brand-800">{{ t('dashboard.notYet', { products: productList(row.notYet) }) }}</p>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div
          v-else-if="detailKey === 'people'"
          id="detail-panel-people"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-people"
        >
          <p v-if="!dashboard.people.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noActivity') }}
          </p>
          <ul v-else class="grid gap-3">
          <li v-for="row in dashboard.people" :key="row.uid" class="card rounded-2xl p-4">
            <p class="truncate font-semibold text-slate-900">{{ nameFor(row.uid) }}</p>
            <dl class="mt-3 grid grid-cols-4 gap-2">
              <div>
                <dd class="text-2xl font-semibold tabular-nums text-brand-800">{{ row.workedOn }}</dd>
                <dt class="mt-0.5 text-xs text-slate-500">{{ t('dashboard.workedOn') }}</dt>
              </div>
              <div>
                <dd class="text-2xl font-semibold tabular-nums text-sky-900">{{ row.reached }}</dd>
                <dt class="mt-0.5 text-xs text-slate-500">{{ t('dashboard.reached') }}</dt>
              </div>
              <div>
                <dd class="text-2xl font-semibold tabular-nums text-emerald-800">{{ row.won }}</dd>
                <dt class="mt-0.5 text-xs text-slate-500">{{ t('dashboard.won') }}</dt>
              </div>
              <div>
                <dd class="text-2xl font-semibold tabular-nums text-rose-800">{{ row.lost }}</dd>
                <dt class="mt-0.5 text-xs text-slate-500">{{ t('dashboard.lost') }}</dt>
              </div>
            </dl>
          </li>
          </ul>
        </div>

        <div
          v-else-if="detailKey === 'products'"
          id="detail-panel-products"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-products"
        >
          <p v-if="!wonActive.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noneSold') }}
          </p>
          <div v-else class="card rounded-2xl p-4">
            <div v-for="row in wonActive" :key="row.key" class="py-2 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between gap-3">
                <span class="min-w-0 truncate text-sm font-medium text-slate-800">{{ t(`productType.${row.key}`) }}</span>
                <span class="text-2xl font-semibold tabular-nums text-brand-800">{{ row.count }}</span>
              </div>
              <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-brand-600" :style="{ width: barWidth(row.count, wonMax) }" />
              </div>
            </div>
            <p v-if="wonQuietLabel" class="mt-3 text-xs text-slate-500">
              {{ t('dashboard.alsoQuiet', { names: wonQuietLabel }) }}
            </p>
          </div>
        </div>

        <div
          v-else-if="detailKey === 'lost'"
          id="detail-panel-lost"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-lost"
        >
          <p v-if="!lostActive.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noneLost') }}
          </p>
          <div v-else class="card rounded-2xl p-4">
            <div v-for="row in lostActive" :key="row.key" class="py-2 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between gap-3">
                <span class="min-w-0 truncate text-sm font-medium text-slate-800">{{ t(`lossReason.${row.key}`) }}</span>
                <span class="text-2xl font-semibold tabular-nums text-rose-800">{{ row.count }}</span>
              </div>
              <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-rose-700" :style="{ width: barWidth(row.count, lostMax) }" />
              </div>
            </div>
            <p v-if="lostQuietLabel" class="mt-3 text-xs text-slate-500">
              {{ t('dashboard.alsoQuiet', { names: lostQuietLabel }) }}
            </p>
          </div>
        </div>

        <div
          v-else-if="detailKey === 'events'"
          id="detail-panel-events"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-events"
        >
          <p v-if="!dashboard.upcomingEvents.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noUpcomingEvents') }}
          </p>
          <ul v-else class="grid gap-2 lg:grid-cols-2">
            <li v-for="lead in dashboard.upcomingEvents" :key="lead.id" class="lead-card">
              <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="block p-4">
                <p class="truncate font-semibold text-slate-900">{{ leadName(lead) }}</p>
                <p class="mt-1 text-sm text-slate-600">
                  {{ lead.eventType ? t(`eventType.${lead.eventType}`) : t('common.none') }}
                  · {{ formatDate(lead.eventDate) }}
                </p>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div
          v-else
          id="detail-panel-hot"
          class="mt-3"
          role="tabpanel"
          aria-labelledby="detail-tab-hot"
        >
          <p v-if="!dashboard.hotLeads.length" class="card rounded-2xl px-4 py-8 text-center text-sm text-slate-600">
            {{ t('dashboard.noHotLeads') }}
          </p>
          <ul v-else class="grid gap-2 lg:grid-cols-2">
            <li v-for="lead in dashboard.hotLeads" :key="lead.id" class="lead-card">
              <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="flex items-center gap-3 p-4">
                <div
                  class="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  :class="avatarToneFromSeed(lead.displayName || lead.id)"
                  aria-hidden="true"
                >
                  {{ initialsFromName(leadName(lead)) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-2 truncate font-semibold text-slate-900">
                    <span class="truncate">{{ leadName(lead) }}</span>
                    <span class="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-800 ring-inset">
                      {{ t('leadDetail.hot') }}
                    </span>
                  </p>
                  <p class="mt-0.5 text-sm tabular-nums text-slate-600">{{ lead.primaryPhone }}</p>
                </div>
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
