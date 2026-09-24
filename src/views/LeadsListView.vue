<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useLeadsStore } from '@/stores/leads.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { useNow } from '@/composables/useNow.js'
import { leadBucket, describeLead } from '@/domain/followUp.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { LEAD_SOURCES } from '@/domain/taxonomies.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

const { t } = useI18n()
const auth = useAuthStore()
const leadsStore = useLeadsStore()
const now = useNow()

const { items, loading, isEmpty, hasMore, loadingMore, loadMore } = leadsStore.leadList()
const { names } = useUserNames(() => auth.orgId)

const search = ref('')
const ownerFilter = ref('')
const sourceFilter = ref('')
const bucketFilter = ref('')

const BUCKET_TOKEN = { dueNew: 'new', dueOverdue: 'overdue', dueToday: 'today', dueUpcoming: 'upcoming' }

const STATS = [
  {
    key: 'dueNew',
    countKey: 'new',
    labelKey: 'leads.dueNew',
    idle: 'text-sky-900',
    selected: 'bg-sky-800 text-white ring-sky-800',
  },
  {
    key: 'dueOverdue',
    countKey: 'overdue',
    labelKey: 'leads.dueOverdue',
    idle: 'text-rose-800',
    selected: 'bg-rose-800 text-white ring-rose-800',
  },
  {
    key: 'dueToday',
    countKey: 'today',
    labelKey: 'leads.dueToday',
    idle: 'text-amber-900',
    selected: 'bg-amber-800 text-white ring-amber-800',
  },
  {
    key: 'dueUpcoming',
    countKey: 'upcoming',
    labelKey: 'leads.dueUpcoming',
    idle: 'text-brand-800',
    selected: 'bg-brand-700 text-white ring-brand-700',
  },
  {
    key: 'dueNone',
    countKey: 'none',
    labelKey: 'leads.dueNone',
    idle: 'text-slate-800',
    selected: 'bg-slate-800 text-white ring-slate-800',
  },
]

const ownerOptions = computed(() =>
  Array.from(names.value, ([id, displayName]) => ({ id, displayName: displayName || id })),
)

function ownerName(uid) {
  return names.value.get(uid) ?? uid
}

function dueText(lead) {
  const d = describeLead(lead, now.value)
  return d ? t(`nextAction.${d.key}`, { count: d.count }) : t('leads.dueNone')
}

function displayName(lead) {
  return lead.displayName || t('lead.unnamed')
}

function initials(lead) {
  return initialsFromName(displayName(lead))
}

function avatarTone(lead) {
  return avatarToneFromSeed(lead.displayName || lead.id)
}

function bucketOf(lead) {
  return leadBucket(lead, now.value)
}

function accentClass(lead) {
  const bucket = bucketOf(lead)
  if (bucket === 'new') return 'border-l-[3px] border-l-sky-600'
  if (bucket === 'overdue') return 'border-l-[3px] border-l-urgent-critical'
  if (bucket === 'today') return 'border-l-[3px] border-l-urgent-high'
  if (bucket === 'upcoming') return 'border-l-[3px] border-l-brand-600'
  return 'border-l-[3px] border-l-slate-500'
}

function dueBadgeClass(lead) {
  const bucket = bucketOf(lead)
  if (bucket === 'new') return 'bg-sky-50 text-sky-900 ring-sky-700'
  if (bucket === 'overdue') return 'bg-rose-50 text-rose-800 ring-rose-700'
  if (bucket === 'today') return 'bg-amber-50 text-amber-900 ring-amber-800'
  if (bucket === 'upcoming') return 'bg-brand-50 text-brand-800 ring-brand-600'
  return 'bg-slate-100 text-slate-700 ring-slate-500'
}

function whatsAppLink(lead) {
  return toWhatsAppLink(lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName(lead) }))
}

/** Search + source + owner, before the follow-up chip — so chip counts stay useful. */
const scoped = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((lead) => {
    if (q) {
      const haystack = `${lead.displayName ?? ''} ${lead.primaryPhone ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (ownerFilter.value && lead.ownerId !== ownerFilter.value) return false
    if (sourceFilter.value && lead.source !== sourceFilter.value) return false
    return true
  })
})

const bucketCounts = computed(() => {
  const counts = { new: 0, overdue: 0, today: 0, upcoming: 0, none: 0 }
  for (const lead of scoped.value) {
    const bucket = bucketOf(lead)
    if (bucket) counts[bucket] += 1
    else counts.none += 1
  }
  return counts
})

const filtered = computed(() => {
  if (!bucketFilter.value) return scoped.value
  return scoped.value.filter((lead) => {
    const bucket = bucketOf(lead)
    if (bucketFilter.value === 'dueNone') return bucket === null
    return bucket === BUCKET_TOKEN[bucketFilter.value]
  })
})

const hasActiveFilters = computed(
  () => Boolean(search.value || ownerFilter.value || sourceFilter.value || bucketFilter.value),
)

function toggleBucket(key) {
  bucketFilter.value = bucketFilter.value === key ? '' : key
}

function clearSearch() {
  search.value = ''
}

function clearFilters() {
  search.value = ''
  ownerFilter.value = ''
  sourceFilter.value = ''
  bucketFilter.value = ''
}
</script>

<template>
  <div class="page-shell">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('nav.leads') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ t('leads.subtitle', { count: items.length }) }}</p>
      </div>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary shrink-0 shadow-sm shadow-brand-700/20">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div
      class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      role="group"
      :aria-label="t('leads.filterFollowUp')"
    >
      <button
        v-for="stat in STATS"
        :key="stat.key"
        type="button"
        class="stat-chip cursor-pointer"
        :class="bucketFilter === stat.key ? stat.selected : 'text-slate-700'"
        :aria-pressed="bucketFilter === stat.key"
        @click="toggleBucket(stat.key)"
      >
        <span
          class="text-xl font-semibold tabular-nums leading-none"
          :class="bucketFilter === stat.key ? 'text-white' : stat.idle"
        >
          {{ bucketCounts[stat.countKey] }}
        </span>
        <span class="mt-1.5 text-xs font-medium leading-tight">{{ t(stat.labelKey) }}</span>
      </button>
    </div>

    <div class="card mt-4 p-3 sm:p-4">
      <div class="relative">
        <label for="leads-search" class="sr-only">{{ t('leads.searchLabel') }}</label>
        <svg
          class="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-600"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" />
          <path d="M16.5 16.5 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <input
          id="leads-search"
          v-model="search"
          type="search"
          class="field-input pr-12 pl-11"
          :placeholder="t('leads.searchPlaceholder')"
        />
        <button
          v-if="search"
          type="button"
          class="icon-btn absolute top-1/2 right-1 -translate-y-1/2"
          :aria-label="t('leads.clearSearch')"
          @click="clearSearch"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2" :class="auth.isManager ? 'sm:grid-cols-2' : ''">
        <select v-model="sourceFilter" class="field-input" :aria-label="t('leads.allSources')">
          <option value="">{{ t('leads.allSources') }}</option>
          <option v-for="s in LEAD_SOURCES" :key="s" :value="s">{{ t(`source.${s}`) }}</option>
        </select>
        <select
          v-if="auth.isManager"
          v-model="ownerFilter"
          class="field-input"
          :aria-label="t('leads.owner')"
        >
          <option value="">{{ t('leads.allOwners') }}</option>
          <option v-for="u in ownerOptions" :key="u.id" :value="u.id">{{ u.displayName }}</option>
        </select>
      </div>
    </div>

    <p class="mt-4 text-sm text-slate-600">
      {{ t('leads.showing', { shown: filtered.length, total: items.length }) }}
    </p>

    <div
      v-if="loading && !items.length"
      class="mt-3 grid gap-3 lg:grid-cols-2"
      aria-busy="true"
      aria-live="polite"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="n in 6" :key="n" class="card overflow-hidden p-4">
        <div class="flex gap-3">
          <div class="size-11 shrink-0 animate-pulse rounded-full bg-slate-200" />
          <div class="min-w-0 flex-1 space-y-2 py-0.5">
            <div class="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div class="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
            <div class="mt-3 h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="isEmpty" class="card mt-3 px-6 py-12 text-center">
      <div class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <svg class="size-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M8 7h8M8 12h5M7 4h10a2 2 0 0 1 2 2v14l-3.5-2-3.5 2-3.5-2L5 20V6a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <p class="mt-4 text-base font-semibold text-slate-900">{{ t('leads.none') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('leads.noneBody') }}</p>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary mt-5">
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div v-else-if="!filtered.length" class="card mt-3 px-6 py-12 text-center">
      <p class="text-base font-semibold text-slate-900">{{ t('leads.noMatches') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('leads.noMatchesBody') }}</p>
      <button v-if="hasActiveFilters" type="button" class="btn-secondary mt-4" @click="clearFilters">
        {{ t('leads.clearFilters') }}
      </button>
    </div>

    <ul v-else class="mt-3 grid gap-3 lg:grid-cols-2">
      <li
        v-for="(lead, index) in filtered"
        :key="lead.id"
        class="lead-card lead-card-enter"
        :class="[accentClass(lead), bucketOf(lead) === 'overdue' ? 'bg-rose-50/50' : '']"
        :style="{ animationDelay: `${Math.min(index, 10) * 40}ms` }"
      >
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              :class="avatarTone(lead)"
              aria-hidden="true"
            >
              {{ initials(lead) }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <p class="truncate font-semibold text-slate-900">{{ displayName(lead) }}</p>
                <span
                  v-if="lead.isHot"
                  class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-800 ring-inset"
                >
                  <svg class="size-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2.5 14.5 9h6.2l-5 3.9 1.9 6.4L12 15.8 6.4 19.3 8.3 12.9l-5-3.9h6.2L12 2.5Z" />
                  </svg>
                  {{ t('leadDetail.hot') }}
                </span>
              </div>
              <p class="mt-0.5 text-sm tabular-nums text-slate-600">{{ lead.primaryPhone }}</p>
              <p class="mt-1 truncate text-sm text-slate-600">
                <template v-if="lead.eventType">{{ t(`eventType.${lead.eventType}`) }}</template>
                <template v-if="lead.eventType && lead.source"> · </template>
                <template v-if="lead.source">{{ t(`source.${lead.source}`) }}</template>
                <span v-if="auth.isManager" class="text-slate-500">
                  <template v-if="lead.eventType || lead.source"> · </template>
                  {{ ownerName(lead.ownerId) }}
                </span>
              </p>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
              :class="dueBadgeClass(lead)"
            >
              <svg class="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
                <path d="M12 8v4.5L15 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              {{ dueText(lead) }}
            </span>
          </div>

          <div class="relative z-10 mt-3 flex flex-wrap gap-2">
            <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary shrink-0 text-sm">
              <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6.5 4.5h3L11 8l-2 1.5a12 12 0 0 0 5.5 5.5L16 13l3.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 6.1 1.5 1.5 0 0 1 6.5 4.5Z"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                />
              </svg>
              {{ t('lead.call') }}
            </a>
            <a
              :href="whatsAppLink(lead)"
              target="_blank"
              rel="noopener"
              class="btn-whatsapp shrink-0 text-sm"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M12.04 3.5A8.45 8.45 0 0 0 3.6 12c0 1.48.39 2.93 1.13 4.2L3.5 20.5l2.4-1.2A8.45 8.45 0 0 0 20.5 12 8.45 8.45 0 0 0 12.04 3.5Zm4.73 12.03c-.2.56-1.16 1.03-1.6 1.07-.41.04-.9.06-1.46-.09-.33-.09-.76-.25-1.31-.49-2.31-1-3.81-3.32-3.93-3.47-.11-.16-.94-1.25-.94-2.38 0-1.14.6-1.7.81-1.93.2-.23.45-.29.6-.29h.43c.14 0 .33-.05.51.39.2.48.67 1.64.73 1.76.06.12.1.26.02.41-.08.16-.12.26-.24.4-.12.14-.25.31-.36.42-.12.12-.24.24-.1.47.14.23.62 1.02 1.33 1.65.91.82 1.68 1.07 1.91 1.19.23.12.37.1.5-.06.14-.16.58-.67.73-.9.16-.23.31-.19.51-.12.2.08 1.29.61 1.51.72.22.11.37.16.42.25.06.1.06.56-.14 1.12Z"
                />
              </svg>
              {{ t('lead.whatsapp') }}
            </a>
          </div>
        </div>

        <RouterLink
          :to="{ name: 'lead-detail', params: { id: lead.id } }"
          class="absolute inset-0 z-0 rounded-2xl"
          :aria-label="displayName(lead)"
        />
      </li>
    </ul>

    <button
      v-if="hasMore"
      type="button"
      class="btn-secondary mt-4 w-full"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ t('leads.loadMore') }}
    </button>
  </div>
</template>
