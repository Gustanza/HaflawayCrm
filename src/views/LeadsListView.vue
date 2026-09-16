<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useLeadsStore } from '@/stores/leads.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { useNow } from '@/composables/useNow.js'
import { queueBucket, describeFollowUp } from '@/domain/followUp.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { LEAD_SOURCES } from '@/domain/taxonomies.js'

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

const BUCKET_OPTIONS = ['dueOverdue', 'dueToday', 'dueUpcoming', 'dueNone']
const BUCKET_TOKEN = { dueOverdue: 'overdue', dueToday: 'today', dueUpcoming: 'upcoming' }

const ownerOptions = computed(() =>
  Array.from(names.value, ([id, displayName]) => ({ id, displayName: displayName || id })),
)

function ownerName(uid) {
  return names.value.get(uid) ?? uid
}

function dueText(lead) {
  const d = describeFollowUp(lead.nextFollowUpAt, now.value)
  return d ? t(`nextAction.${d.key}`, { count: d.count }) : ''
}

function displayName(lead) {
  return lead.displayName || t('lead.unnamed')
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((lead) => {
    if (q) {
      const haystack = `${lead.displayName ?? ''} ${lead.primaryPhone ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (ownerFilter.value && lead.ownerId !== ownerFilter.value) return false
    if (sourceFilter.value && lead.source !== sourceFilter.value) return false
    if (bucketFilter.value) {
      const bucket = queueBucket(lead.nextFollowUpAt, now.value)
      if (bucketFilter.value === 'dueNone') {
        if (bucket !== null) return false
      } else if (bucket !== BUCKET_TOKEN[bucketFilter.value]) {
        return false
      }
    }
    return true
  })
})

const hasActiveFilters = computed(
  () => Boolean(search.value || ownerFilter.value || sourceFilter.value || bucketFilter.value),
)

function clearFilters() {
  search.value = ''
  ownerFilter.value = ''
  sourceFilter.value = ''
  bucketFilter.value = ''
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.leads') }}</h1>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary shrink-0">
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div class="mt-4">
      <label for="leads-search" class="sr-only">{{ t('leads.searchLabel') }}</label>
      <input
        id="leads-search"
        v-model="search"
        type="search"
        class="field-input"
        :placeholder="t('leads.searchPlaceholder')"
      />
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <select v-model="bucketFilter" class="field-input" :aria-label="t('leads.filterFollowUp')">
        <option value="">{{ t('leads.filterFollowUp') }}: {{ t('leads.all') }}</option>
        <option v-for="b in BUCKET_OPTIONS" :key="b" :value="b">{{ t(`leads.${b}`) }}</option>
      </select>
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

    <p class="mt-3 text-sm text-slate-600">{{ t('leads.showing', { shown: filtered.length, total: items.length }) }}</p>

    <div v-if="loading && !items.length" class="mt-8 text-center text-sm text-slate-500">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="isEmpty" class="mt-10 text-center">
      <p class="text-base font-medium text-slate-900">{{ t('leads.none') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('leads.noneBody') }}</p>
    </div>

    <div v-else-if="!filtered.length" class="mt-10 text-center">
      <p class="text-base font-medium text-slate-900">{{ t('leads.noMatches') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('leads.noMatchesBody') }}</p>
      <button v-if="hasActiveFilters" type="button" class="btn-secondary mt-3" @click="clearFilters">
        {{ t('leads.clearFilters') }}
      </button>
    </div>

    <ul v-else class="mt-2 space-y-2">
      <li v-for="lead in filtered" :key="lead.id" class="card p-3">
        <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="block">
          <p class="font-medium text-slate-900">{{ displayName(lead) }}</p>
          <p class="text-sm text-slate-600">{{ lead.primaryPhone }}</p>
          <p class="mt-1 text-sm text-slate-700">{{ dueText(lead) }}</p>
          <p v-if="auth.isManager" class="text-xs text-slate-500">{{ ownerName(lead.ownerId) }}</p>
        </RouterLink>
        <div class="mt-2.5 flex flex-wrap gap-2">
          <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary text-sm">{{ t('lead.call') }}</a>
          <a :href="toWhatsAppLink(lead.primaryPhone)" target="_blank" rel="noopener" class="btn-secondary text-sm">
            {{ t('lead.whatsapp') }}
          </a>
        </div>
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
