<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDashboardStore } from '@/stores/dashboard.js'
import { PRODUCT_TYPES, LOST_REASONS } from '@/domain/taxonomies.js'

const { t } = useI18n()
const dashboard = useDashboardStore()

onMounted(() => {
  dashboard.load()
})

function formatDate(value) {
  const d = value?.toDate ? value.toDate() : value
  return d instanceof Date ? d.toLocaleDateString() : ''
}

function leadName(lead) {
  return lead.displayName || t('lead.unnamed')
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.dashboard') }}</h1>

    <div class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="p in dashboard.PERIODS"
        :key="p"
        type="button"
        class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors"
        style="min-height: var(--spacing-touch)"
        :class="dashboard.period === p
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
        @click="dashboard.setPeriod(p)"
      >
        {{ t(`dashboard.period.${p}`) }}
      </button>
    </div>

    <div v-if="dashboard.loading && !dashboard.loaded" class="mt-8 text-center text-sm text-slate-500">
      {{ t('common.loading') }}
    </div>

    <template v-else>
      <div class="mt-5 grid grid-cols-2 gap-3">
        <div class="card p-4">
          <p class="text-2xl font-semibold text-slate-900">{{ dashboard.leadsCreated }}</p>
          <p class="text-sm text-slate-600">{{ t('dashboard.leadsCreated') }}</p>
        </div>
        <div class="card p-4">
          <p class="text-2xl font-semibold text-slate-900">{{ dashboard.contactsMade }}</p>
          <p class="text-sm text-slate-600">{{ t('dashboard.contactsMade') }}</p>
        </div>
      </div>

      <section class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('dashboard.closedWonByProduct') }}
        </h2>
        <div class="card mt-2 divide-y divide-slate-100">
          <div v-for="p in PRODUCT_TYPES" :key="p" class="flex items-center justify-between px-4 py-2.5">
            <span class="text-sm text-slate-700">{{ t(`productType.${p}`) }}</span>
            <span class="text-sm font-medium tabular-nums text-slate-900">
              {{ dashboard.closedWonByProduct[p] ?? 0 }}
            </span>
          </div>
          <div class="flex items-center justify-between px-4 py-2.5 font-medium">
            <span class="text-sm text-slate-900">{{ t('dashboard.closedWon') }}</span>
            <span class="text-sm tabular-nums text-slate-900">{{ dashboard.totalClosedWon }}</span>
          </div>
        </div>
      </section>

      <section class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('dashboard.lostByReason') }}
        </h2>
        <div class="card mt-2 divide-y divide-slate-100">
          <div v-for="r in LOST_REASONS" :key="r" class="flex items-center justify-between px-4 py-2.5">
            <span class="text-sm text-slate-700">{{ t(`lossReason.${r}`) }}</span>
            <span class="text-sm font-medium tabular-nums text-slate-900">
              {{ dashboard.lostByReason[r] ?? 0 }}
            </span>
          </div>
        </div>
      </section>

      <section class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('dashboard.upcomingEvents') }}
        </h2>
        <p v-if="!dashboard.upcomingEvents.length" class="mt-2 text-sm text-slate-600">
          {{ t('dashboard.noUpcomingEvents') }}
        </p>
        <ul v-else class="mt-2 space-y-2">
          <li v-for="lead in dashboard.upcomingEvents" :key="lead.id" class="card p-3">
            <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="block">
              <p class="font-medium text-slate-900">{{ leadName(lead) }}</p>
              <p class="text-sm text-slate-600">
                {{ lead.eventType ? t(`eventType.${lead.eventType}`) : t('common.none') }}
                · {{ formatDate(lead.eventDate) }}
              </p>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ t('dashboard.hotLeads') }}
        </h2>
        <p v-if="!dashboard.hotLeads.length" class="mt-2 text-sm text-slate-600">
          {{ t('dashboard.noHotLeads') }}
        </p>
        <ul v-else class="mt-2 space-y-2">
          <li v-for="lead in dashboard.hotLeads" :key="lead.id" class="card p-3">
            <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="block">
              <p class="font-medium text-slate-900">🔥 {{ leadName(lead) }}</p>
              <p class="text-sm text-slate-600">{{ lead.primaryPhone }}</p>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
