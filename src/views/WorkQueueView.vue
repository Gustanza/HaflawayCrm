<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useNow } from '@/composables/useNow.js'
import { leadBucket, describeLead } from '@/domain/followUp.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import SnoozeDialog from '@/components/leads/SnoozeDialog.vue'

const { t } = useI18n()
const leadsStore = useLeadsStore()
const { items, loading, isEmpty, error, load } = leadsStore.workQueue()
const now = useNow()

// "New" leads nobody has contacted yet come first: the best moment to reach someone is
// right after they got in touch. After 24 hours untouched they move to Overdue.
const SECTIONS = [
  {
    key: 'new',
    labelKey: 'queue.new',
    idle: 'text-sky-900',
    selected: 'bg-sky-800 text-white ring-sky-800',
    accent: 'border-l-[3px] border-l-sky-600',
    badge: 'bg-sky-50 text-sky-900 ring-sky-700',
  },
  {
    key: 'overdue',
    labelKey: 'queue.overdue',
    idle: 'text-rose-800',
    selected: 'bg-rose-800 text-white ring-rose-800',
    accent: 'border-l-[3px] border-l-urgent-critical',
    badge: 'bg-rose-50 text-rose-800 ring-rose-700',
  },
  {
    key: 'today',
    labelKey: 'queue.today',
    idle: 'text-amber-900',
    selected: 'bg-amber-800 text-white ring-amber-800',
    accent: 'border-l-[3px] border-l-urgent-high',
    badge: 'bg-amber-50 text-amber-900 ring-amber-800',
  },
  {
    key: 'upcoming',
    labelKey: 'queue.upcoming',
    idle: 'text-brand-800',
    selected: 'bg-brand-700 text-white ring-brand-700',
    accent: 'border-l-[3px] border-l-brand-600',
    badge: 'bg-brand-50 text-brand-800 ring-brand-600',
  },
]

/** How many cards to paint before asking for the next page. A bucket can hold
 *  hundreds of leads; the rest stay one tap away instead of a long scroll. */
const PAGE_SIZE = 20

/** Empty until the rep picks a queue. Until then the view follows the most urgent
 *  bucket that still has someone in it, and never stacks the others underneath. */
const chosen = ref('')
const shown = ref(PAGE_SIZE)

const buckets = computed(() => {
  const out = { new: [], overdue: [], today: [], upcoming: [] }
  for (const lead of items.value) {
    const bucket = leadBucket(lead, now.value)
    if (bucket) out[bucket].push(lead)
  }
  return out
})

const activeKey = computed(() => {
  if (chosen.value && SECTIONS.some((section) => section.key === chosen.value)) return chosen.value
  return SECTIONS.find((section) => buckets.value[section.key].length)?.key || ''
})

const activeSection = computed(() => SECTIONS.find((section) => section.key === activeKey.value) || null)

const activeLeads = computed(() => (activeKey.value ? buckets.value[activeKey.value] : []))

const visibleLeads = computed(() => activeLeads.value.slice(0, shown.value))

const hiddenCount = computed(() => Math.max(0, activeLeads.value.length - visibleLeads.value.length))

const nextBatch = computed(() => Math.min(PAGE_SIZE, hiddenCount.value))

/** The other queue to offer once this one is clear — most urgent first. */
const nextSection = computed(() =>
  SECTIONS.find((section) => section.key !== activeKey.value && buckets.value[section.key].length) || null,
)

watch(activeKey, () => {
  shown.value = PAGE_SIZE
})

function dueText(lead) {
  const d = describeLead(lead, now.value)
  return d ? t(`nextAction.${d.key}`, { count: d.count }) : ''
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

function whatsAppLink(lead) {
  return toWhatsAppLink(lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName(lead) }))
}

function selectBucket(key) {
  const same = key === activeKey.value
  chosen.value = key
  if (!same) window.scrollTo({ top: 0, behavior: 'auto' })
}

function onTabKeydown(event, index) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % SECTIONS.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + SECTIONS.length) % SECTIONS.length
  else if (event.key === 'Home') next = 0
  else next = SECTIONS.length - 1
  const key = SECTIONS[next].key
  selectBucket(key)
  nextTick(() => document.getElementById(`queue-tab-${key}`)?.focus())
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
  <div class="page-shell">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="page-title">{{ t('nav.workQueue') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ t('queue.subtitle', { count: items.length }) }}</p>
      </div>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary shrink-0 shadow-sm shadow-brand-700/20">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div
      v-if="items.length"
      class="sticky top-0 z-20 -mx-4 mt-5 bg-slate-50/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
      role="tablist"
      :aria-label="t('queue.focusLabel')"
    >
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          v-for="(section, index) in SECTIONS"
          :id="`queue-tab-${section.key}`"
          :key="section.key"
          type="button"
          role="tab"
          class="stat-chip cursor-pointer"
          :class="activeKey === section.key
            ? section.selected
            : buckets[section.key].length ? 'text-slate-700' : 'text-slate-400'"
          :aria-selected="activeKey === section.key"
          :aria-controls="`queue-panel-${section.key}`"
          :tabindex="activeKey === section.key ? 0 : -1"
          @click="selectBucket(section.key)"
          @keydown="onTabKeydown($event, index)"
        >
          <span
            class="text-xl font-semibold tabular-nums leading-none"
            :class="activeKey === section.key
              ? 'text-white'
              : buckets[section.key].length ? section.idle : 'text-slate-400'"
          >
            {{ buckets[section.key].length }}
          </span>
          <span class="mt-1.5 text-xs font-medium leading-tight">{{ t(section.labelKey) }}</span>
        </button>
      </div>
    </div>

    <!-- A failed live listener leaves the cached copy on screen. Say so, rather than let
         someone log a call and watch the lead stay "overdue" with no explanation. -->
    <div
      v-if="error"
      class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-800 ring-inset"
      role="alert"
    >
      <p>{{ t('errors.staleData') }}</p>
      <button type="button" class="btn-secondary shrink-0 text-sm" @click="load()">
        {{ t('common.retry') }}
      </button>
    </div>

    <div
      v-if="loading && !items.length"
      class="mt-5 grid gap-3 lg:grid-cols-2"
      aria-busy="true"
      aria-live="polite"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div v-for="n in 4" :key="n" class="card overflow-hidden p-4">
        <div class="flex gap-3">
          <div class="size-11 shrink-0 animate-pulse rounded-full bg-slate-200" />
          <div class="min-w-0 flex-1 space-y-2 py-0.5">
            <div class="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div class="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="isEmpty" class="card mt-5 px-6 py-12 text-center">
      <div class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800">
        <svg class="size-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12.5 9.5 17 19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <p class="mt-4 text-base font-semibold text-slate-900">{{ t('queue.allClear') }}</p>
      <p class="mt-1 text-sm text-slate-600">{{ t('queue.allClearBody') }}</p>
      <RouterLink :to="{ name: 'lead-new' }" class="btn-primary mt-5">
        {{ t('nav.newLead') }}
      </RouterLink>
    </div>

    <div v-else-if="!activeLeads.length" class="card mt-5 px-6 py-12 text-center">
      <p class="text-base font-semibold text-slate-900">
        {{ t('queue.focusClear', { bucket: activeSection ? t(activeSection.labelKey) : '' }) }}
      </p>
      <p v-if="nextSection" class="mt-1 text-sm text-slate-600">
        {{ t('queue.focusClearNext', { count: buckets[nextSection.key].length, bucket: t(nextSection.labelKey) }) }}
      </p>
      <p v-else class="mt-1 text-sm text-slate-600">{{ t('queue.focusClearBody') }}</p>
      <button
        v-if="nextSection"
        type="button"
        class="btn-secondary mt-4"
        @click="selectBucket(nextSection.key)"
      >
        {{ t('queue.openBucket', { bucket: t(nextSection.labelKey) }) }}
      </button>
    </div>

    <section
      v-else-if="activeSection"
      :id="`queue-panel-${activeSection.key}`"
      class="mt-2"
      role="tabpanel"
      :aria-labelledby="`queue-tab-${activeSection.key}`"
    >
      <ul class="grid gap-3 lg:grid-cols-2">
            <li
              v-for="(lead, index) in visibleLeads"
              :key="lead.id"
              class="lead-card lead-card-enter"
              :class="[activeSection.accent, activeSection.key === 'overdue' ? 'bg-rose-50/50' : '']"
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
                    <p class="truncate font-semibold text-slate-900">{{ displayName(lead) }}</p>
                    <p class="mt-0.5 text-sm tabular-nums text-slate-600">{{ lead.primaryPhone }}</p>
                  </div>
                </div>

                <div class="mt-3">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
                    :class="activeSection.badge"
                  >
                    {{ dueText(lead) }}
                  </span>
                </div>

                <div class="relative z-10 mt-3 flex flex-wrap gap-2">
                  <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary shrink-0 text-sm">
                    {{ t('lead.call') }}
                  </a>
                  <a
                    :href="whatsAppLink(lead)"
                    target="_blank"
                    rel="noopener"
                    class="btn-whatsapp shrink-0 text-sm"
                  >
                    {{ t('lead.whatsapp') }}
                  </a>
                  <button type="button" class="btn-secondary shrink-0 text-sm" @click="openLog(lead)">
                    {{ t('lead.log') }}
                  </button>
                  <button type="button" class="btn-ghost shrink-0 text-sm" @click="openSnooze(lead)">
                    {{ t('lead.snooze') }}
                  </button>
                </div>
              </div>

              <RouterLink
                :to="{ name: 'lead-detail', params: { id: lead.id } }"
                class="absolute inset-0 z-0 rounded-2xl"
                :aria-label="displayName(lead)"
              />
            </li>
      </ul>

      <div v-if="hiddenCount" class="mt-4 flex flex-col items-center gap-2 pb-2">
        <p class="text-sm text-slate-600">
          {{ t('queue.showing', { shown: visibleLeads.length, total: activeLeads.length }) }}
        </p>
        <button type="button" class="btn-secondary" @click="shown += PAGE_SIZE">
          {{ t('queue.loadMore', { count: nextBatch }) }}
        </button>
      </div>
    </section>

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
