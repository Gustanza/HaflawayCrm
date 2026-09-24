<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useDashboardStore } from '@/stores/dashboard.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { useNow } from '@/composables/useNow.js'
import { daysToEvent, toDate } from '@/domain/periods.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

const { t } = useI18n()
const auth = useAuthStore()
const dashboard = useDashboardStore()
const { nameFor } = useUserNames(() => auth.orgId)
const now = useNow()

const product = ref('all')

onMounted(() => {
  if (!dashboard.loaded) dashboard.load()
})

const DAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const DATE_FMT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const fromDayKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const rangeLabel = computed(() => {
  const { start, end } = dashboard.range
  if (!start || !end) return ''
  if (start === end) return DAY_FMT.format(fromDayKey(start))
  return `${DAY_FMT.format(fromDayKey(start))} – ${DAY_FMT.format(fromDayKey(end))}`
})

function formatDayKey(key) {
  return key ? DATE_FMT.format(fromDayKey(key)) : ''
}

function formatDate(value) {
  const d = toDate(value)
  return d ? d.toLocaleDateString() : ''
}

function displayName(lead) {
  return lead.displayName || t('lead.unnamed')
}

function eventWhen(lead) {
  const days = daysToEvent(lead.eventDate, now.value)
  if (days == null) return t('lead.noEventDate')
  if (days === 0) return t('lead.eventToday')
  if (days === 1) return t('lead.eventTomorrow')
  if (days < 0) return t('lead.eventPassed')
  return t('lead.daysToEvent', { count: days })
}

function eventTone(lead) {
  const days = daysToEvent(lead.eventDate, now.value)
  if (days == null) return 'text-slate-500'
  if (days < 0) return 'text-slate-500'
  if (days <= 14) return 'text-rose-800'
  if (days <= 30) return 'text-amber-900'
  return 'text-emerald-800'
}

const productCounts = computed(() => {
  const counts = new Map()
  for (const row of dashboard.closedDeals) {
    const key = row.deal.productType
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
})

const visible = computed(() => {
  if (product.value === 'all') return dashboard.closedDeals
  return dashboard.closedDeals.filter((row) => row.deal.productType === product.value)
})

const clientCount = computed(() => new Set(visible.value.map((row) => row.lead.id)).size)

const capped = computed(() => {
  const total = dashboard.current?.won ?? 0
  return total > dashboard.closedDeals.length
})
</script>

<template>
  <div class="page-shell">
    <RouterLink :to="{ name: 'dashboard' }" class="text-sm font-medium text-brand-800 hover:underline">
      ← {{ t('wins.back') }}
    </RouterLink>
    <h1 class="page-title mt-2">{{ t('nav.dealsWon') }}</h1>
    <p class="mt-1 text-sm text-slate-600">
      {{ rangeLabel }}
      · {{ t('wins.subtitle', { count: visible.length }) }}
      · {{ t('wins.clients', { count: clientCount }) }}
    </p>

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
      class="mt-6 grid gap-3 lg:grid-cols-2"
      aria-busy="true"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="n in 2" :key="n" class="card h-40 animate-pulse rounded-2xl bg-slate-100" />
    </div>

    <div v-else-if="dashboard.error" class="card mt-6 px-6 py-10 text-center">
      <p class="text-sm font-medium text-rose-800">{{ t('errors.loadFailed') }}</p>
      <button type="button" class="btn-secondary mt-4" @click="dashboard.load()">
        {{ t('common.retry') }}
      </button>
    </div>

    <template v-else>
      <div v-if="productCounts.length" class="mt-5 flex flex-wrap gap-2" role="group" :aria-label="t('wins.allProducts')">
        <button
          type="button"
          class="cursor-pointer rounded-full px-3 text-sm font-medium ring-1 ring-inset"
          style="min-height: var(--spacing-touch)"
          :class="product === 'all' ? 'bg-emerald-800 text-white ring-emerald-800' : 'bg-white text-slate-700 ring-slate-300'"
          :aria-pressed="product === 'all'"
          @click="product = 'all'"
        >
          {{ t('wins.allProducts') }}
          <span class="ml-1 tabular-nums">{{ dashboard.closedDeals.length }}</span>
        </button>
        <button
          v-for="row in productCounts"
          :key="row.key"
          type="button"
          class="cursor-pointer rounded-full px-3 text-sm font-medium ring-1 ring-inset"
          style="min-height: var(--spacing-touch)"
          :class="product === row.key ? 'bg-emerald-800 text-white ring-emerald-800' : 'bg-white text-slate-700 ring-slate-300'"
          :aria-pressed="product === row.key"
          @click="product = row.key"
        >
          {{ t(`productType.${row.key}`) }}
          <span class="ml-1 tabular-nums">{{ row.count }}</span>
        </button>
      </div>

      <p
        v-if="capped && product === 'all'"
        class="mt-3 text-sm text-slate-600"
      >
        {{ t('wins.mayBeMore', { shown: dashboard.closedDeals.length, total: dashboard.current.won }) }}
      </p>

      <p v-if="!visible.length" class="card mt-5 rounded-2xl px-6 py-12 text-center text-sm text-slate-600">
        {{ product === 'all' ? t('wins.none') : t('wins.noneProduct') }}
      </p>

      <ul v-else class="mt-5 grid gap-3 lg:grid-cols-2">
        <li
          v-for="row in visible"
          :key="row.deal.id"
          class="lead-card border-l-[3px] border-l-emerald-600"
        >
          <div class="p-4">
            <div class="flex items-start gap-3">
              <div
                class="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                :class="avatarToneFromSeed(row.lead.displayName || row.lead.id)"
                aria-hidden="true"
              >
                {{ initialsFromName(displayName(row.lead)) }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2">
                  <span class="truncate font-semibold text-slate-900">{{ displayName(row.lead) }}</span>
                  <span
                    v-if="row.lead.isHot"
                    class="inline-flex shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-800 ring-inset"
                  >
                    {{ t('leadDetail.hot') }}
                  </span>
                </p>
                <p class="mt-0.5 text-sm tabular-nums text-slate-600">{{ row.lead.primaryPhone }}</p>
              </div>
            </div>

            <p class="mt-3 text-base font-semibold text-emerald-800">
              {{ t(`productType.${row.deal.productType}`) }}
            </p>
            <p class="mt-0.5 text-sm text-slate-600">
              {{ t('wins.closedOn', { when: formatDayKey(row.deal.closedDayKey) }) }}
              · {{ t('wins.closedBy', { name: nameFor(row.deal.closedBy) }) }}
            </p>

            <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt class="text-xs text-slate-500">{{ t('lead.eventDate') }}</dt>
                <dd class="font-medium text-slate-900">
                  {{ row.lead.eventType ? t(`eventType.${row.lead.eventType}`) : t('common.none') }}
                  <span v-if="row.lead.eventDate"> · {{ formatDate(row.lead.eventDate) }}</span>
                </dd>
                <dd class="text-xs font-medium" :class="eventTone(row.lead)">{{ eventWhen(row.lead) }}</dd>
                <dd v-if="row.lead.eventDate" class="text-xs text-slate-500">
                  {{ row.lead.eventDateIsFirm ? t('wins.dateFirm') : t('wins.dateLoose') }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">{{ t('lead.owner') }}</dt>
                <dd class="font-medium text-slate-900">{{ nameFor(row.lead.ownerId) }}</dd>
                <dd class="text-xs text-slate-500">
                  {{ t('wins.cameFrom', { source: t(`source.${row.lead.source || 'other'}`) }) }}
                </dd>
                <dd v-if="row.lead.referredBy" class="text-xs text-slate-500">
                  {{ t('wins.referredBy', { name: row.lead.referredBy }) }}
                </dd>
              </div>
            </dl>

            <p v-if="row.openProducts.length" class="mt-3 text-sm font-medium text-amber-900">
              {{ t('wins.stillOpen') }}: {{ row.openProducts.map((p) => t(`productType.${p}`)).join(', ') }}
            </p>
            <p v-if="row.lead.lastActivitySummary" class="mt-1 text-sm text-slate-600">
              {{ t('wins.last', { summary: row.lead.lastActivitySummary }) }}
            </p>

            <div class="relative z-10 mt-3 flex flex-wrap gap-2">
              <a :href="toTelLink(row.lead.primaryPhone)" class="btn-secondary text-sm">{{ t('lead.call') }}</a>
              <a
                :href="toWhatsAppLink(row.lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName(row.lead) }))"
                target="_blank"
                rel="noopener"
                class="btn-whatsapp text-sm"
              >
                {{ t('lead.whatsapp') }}
              </a>
              <RouterLink :to="{ name: 'lead-detail', params: { id: row.lead.id } }" class="btn-secondary text-sm">
                {{ t('wins.openLead') }}
              </RouterLink>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
