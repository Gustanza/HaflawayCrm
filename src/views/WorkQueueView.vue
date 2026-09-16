<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useNow } from '@/composables/useNow.js'
import { queueBucket, describeFollowUp } from '@/domain/followUp.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import SnoozeDialog from '@/components/leads/SnoozeDialog.vue'

const { t } = useI18n()
const leadsStore = useLeadsStore()
const { items, loading, isEmpty } = leadsStore.workQueue()
const now = useNow()

const SECTIONS = [
  { key: 'overdue', labelKey: 'queue.overdue' },
  { key: 'today', labelKey: 'queue.today' },
  { key: 'upcoming', labelKey: 'queue.upcoming' },
]

const buckets = computed(() => {
  const out = { overdue: [], today: [], upcoming: [] }
  for (const lead of items.value) {
    const bucket = queueBucket(lead.nextFollowUpAt, now.value)
    if (bucket) out[bucket].push(lead)
  }
  return out
})

function dueText(lead) {
  const d = describeFollowUp(lead.nextFollowUpAt, now.value)
  return d ? t(`nextAction.${d.key}`, { count: d.count }) : ''
}

function displayName(lead) {
  return lead.displayName || t('lead.unnamed')
}

function whatsAppLink(lead) {
  return toWhatsAppLink(lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName(lead) }))
}

/** { type: 'log' | 'snooze', leadId } | null */
const activeDialog = ref(null)

function openLog(lead) {
  activeDialog.value = { type: 'log', leadId: lead.id }
}
function openSnooze(lead) {
  activeDialog.value = { type: 'snooze', leadId: lead.id }
}
function closeDialog() {
  activeDialog.value = null
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.workQueue') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ t('queue.subtitle', { count: items.length }) }}</p>
      </div>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary shrink-0">
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div v-if="loading && !items.length" class="mt-8 text-center text-sm text-slate-500">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="isEmpty" class="mt-10 text-center">
      <p class="text-base font-medium text-slate-900">{{ t('queue.allClear') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('queue.allClearBody') }}</p>
    </div>

    <template v-else>
      <section v-for="section in SECTIONS" :key="section.key" class="mt-6">
        <template v-if="buckets[section.key].length">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {{ t(section.labelKey) }} · {{ buckets[section.key].length }}
          </h2>

          <ul class="mt-2 space-y-2">
            <li
              v-for="lead in buckets[section.key]"
              :key="lead.id"
              class="card p-3"
              :class="section.key === 'overdue' ? 'bg-rose-50/40' : ''"
            >
              <RouterLink :to="{ name: 'lead-detail', params: { id: lead.id } }" class="block">
                <p class="font-medium text-slate-900">{{ displayName(lead) }}</p>
                <p class="text-sm text-slate-600">{{ lead.primaryPhone }}</p>
                <p
                  class="mt-1 text-sm font-medium"
                  :class="section.key === 'overdue' ? 'text-rose-700' : 'text-slate-700'"
                >
                  {{ dueText(lead) }}
                </p>
              </RouterLink>

              <div class="mt-2.5 flex flex-wrap gap-2">
                <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary text-sm">
                  {{ t('lead.call') }}
                </a>
                <a :href="whatsAppLink(lead)" target="_blank" rel="noopener" class="btn-secondary text-sm">
                  {{ t('lead.whatsapp') }}
                </a>
                <button type="button" class="btn-secondary text-sm" @click="openLog(lead)">
                  {{ t('lead.log') }}
                </button>
                <button type="button" class="btn-ghost text-sm" @click="openSnooze(lead)">
                  {{ t('lead.snooze') }}
                </button>
              </div>
            </li>
          </ul>
        </template>
      </section>
    </template>

    <LogActivityDialog
      v-if="activeDialog?.type === 'log'"
      :lead-id="activeDialog.leadId"
      @close="closeDialog"
      @saved="closeDialog"
    />
    <SnoozeDialog
      v-if="activeDialog?.type === 'snooze'"
      :lead-id="activeDialog.leadId"
      @close="closeDialog"
      @saved="closeDialog"
    />
  </div>
</template>
