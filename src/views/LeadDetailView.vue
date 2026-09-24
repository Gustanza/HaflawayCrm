<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { useNow } from '@/composables/useNow.js'
import { toDate } from '@/domain/periods.js'
import { leadBucket, describeLead } from '@/domain/followUp.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { PRODUCT_TYPES, outcomeMessageKey } from '@/domain/taxonomies.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'
import LogActivityDialog from '@/components/leads/LogActivityDialog.vue'
import SnoozeDialog from '@/components/leads/SnoozeDialog.vue'
import CloseLostDialog from '@/components/leads/CloseLostDialog.vue'
import ReassignDialog from '@/components/leads/ReassignDialog.vue'
import DeleteLeadDialog from '@/components/leads/DeleteLeadDialog.vue'
import Modal from '@/components/ui/Modal.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const auth = useAuthStore()
const leadsStore = useLeadsStore()
const ui = useUiStore()
const now = useNow()

const leadId = computed(() => route.params.id)

const { item: lead, loaded: leadLoaded } = leadsStore.lead(leadId.value)
const { items: deals } = leadsStore.deals(leadId.value)
const { items: activities, hasMore, loadMore, loadingMore } = leadsStore.timeline(leadId.value)

const { names } = useUserNames(() => auth.orgId)
const ownerName = computed(() => names.value.get(lead.value?.ownerId) ?? lead.value?.ownerId ?? '')

const displayName = computed(() => lead.value?.displayName || t('lead.unnamed'))
const initials = computed(() => initialsFromName(displayName.value))
const avatarTone = computed(() => avatarToneFromSeed(lead.value?.displayName || lead.value?.id))

const openDeals = computed(() => deals.value.filter((d) => d.status === 'open'))
const openProductTypes = computed(() => openDeals.value.map((d) => d.productType))
const availableProducts = computed(() => PRODUCT_TYPES.filter((p) => !openProductTypes.value.includes(p)))

const due = computed(() => {
  if (!lead.value) return null
  return describeLead(lead.value, now.value)
})

const dueLabel = computed(() =>
  due.value ? t(`nextAction.${due.value.key}`, { count: due.value.count }) : t('leads.dueNone'),
)

const dueBadgeClass = computed(() => {
  const bucket = lead.value ? leadBucket(lead.value, now.value) : null
  if (bucket === 'new') return 'bg-sky-50 text-sky-900 ring-sky-700'
  if (bucket === 'overdue') return 'bg-rose-50 text-rose-800 ring-rose-700'
  if (bucket === 'today') return 'bg-amber-50 text-amber-900 ring-amber-800'
  if (bucket === 'upcoming') return 'bg-brand-50 text-brand-800 ring-brand-600'
  return 'bg-slate-100 text-slate-700 ring-slate-500'
})

const DEAL_BADGE_CLASS = {
  open: 'bg-slate-100 text-slate-800 ring-slate-500',
  closed_won: 'bg-emerald-50 text-emerald-800 ring-emerald-700',
  closed_lost: 'bg-rose-50 text-rose-800 ring-rose-700',
}

function formatDate(value) {
  const d = toDate(value)
  return d ? d.toLocaleDateString() : ''
}
function formatDateTime(value) {
  const d = toDate(value)
  return d ? d.toLocaleString() : ''
}

/** { type: 'log' | 'snooze' | 'closeLost' | 'reassign' | 'addProduct' | 'delete', dealId? } | null */
const activeDialog = ref(null)
const closeDialog = () => { activeDialog.value = null }

async function toggleHot() {
  ui.trackWrite(
    leadsStore.updateLead(lead.value.id, { isHot: !lead.value.isHot }),
    { onError: (error) => ui.error(t(writeErrorKey(error))) },
  )
  ui.info(t(lead.value.isHot ? 'leadDetail.hotOff' : 'leadDetail.hotOn'))
}

async function markWon(deal) {
  const product = t(`productType.${deal.productType}`)
  if (!window.confirm(t('leadDetail.confirmCloseWon', { product }))) return
  try {
    await leadsStore.closeDeal(leadId.value, deal.id, 'closed_won')
    ui.success(t('leadDetail.closedWon', { product }))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}

async function reopenDeal(deal) {
  try {
    await leadsStore.reopenDeal(leadId.value, deal.id)
    ui.success(t('leadDetail.reopened'))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}

async function removeDeal(deal) {
  const product = t(`productType.${deal.productType}`)
  if (!window.confirm(t('leadDetail.confirmRemoveDeal', { product }))) return
  try {
    await leadsStore.deleteDeal(leadId.value, deal.id)
    ui.success(t('leadDetail.dealRemoved', { product }))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}

function onLeadDeleted() {
  activeDialog.value = null
  router.push({ name: 'leads' })
}

async function addProduct(productType) {
  try {
    await leadsStore.addDeal(leadId.value, lead.value.orgId, productType)
    ui.success(t('leadDetail.productAdded', { product: t(`productType.${productType}`) }))
    closeDialog()
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}

function dealLabel(dealId) {
  const deal = deals.value.find((d) => d.id === dealId)
  return deal ? t(`productType.${deal.productType}`) : ''
}

const voidingId = ref(null)
const voidReason = ref('')

function startVoid(activity) {
  voidingId.value = activity.id
  voidReason.value = ''
}
function cancelVoid() {
  voidingId.value = null
}
async function confirmVoid(activity) {
  if (!voidReason.value.trim()) return
  try {
    await leadsStore.voidActivity(leadId.value, activity.id, voidReason.value)
    ui.success(t('detail.corrected'))
    voidingId.value = null
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  }
}
</script>

<template>
  <div class="page-shell">
    <div v-if="leadLoaded && !lead" class="card rounded-2xl px-6 py-12 text-center">
      <p class="text-base font-semibold text-slate-900">{{ t('detail.notFound') }}</p>
      <RouterLink :to="{ name: 'leads' }" class="btn-primary mt-4">
        {{ t('common.back') }}
      </RouterLink>
    </div>

    <div
      v-else-if="!lead"
      class="space-y-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span class="sr-only">{{ t('common.loading') }}</span>
      <div class="card rounded-2xl p-6">
        <div class="flex gap-4">
          <div class="size-16 shrink-0 animate-pulse rounded-2xl bg-slate-200" />
          <div class="min-w-0 flex-1 space-y-2 py-1">
            <div class="h-6 w-1/2 animate-pulse rounded bg-slate-200" />
            <div class="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </div>
    </div>

    <template v-else>
      <RouterLink
        :to="{ name: 'leads' }"
        class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-800"
        style="min-height: var(--spacing-touch)"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6 9 12l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ t('common.back') }}
      </RouterLink>

      <section class="card overflow-hidden rounded-2xl">
        <div class="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
          <div
            class="flex size-16 shrink-0 items-center justify-center rounded-2xl text-xl font-semibold"
            :class="avatarTone"
            aria-hidden="true"
          >
            {{ initials }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h1 class="truncate text-2xl font-semibold tracking-tight text-slate-900">{{ displayName }}</h1>
                <p class="mt-0.5 text-sm tabular-nums text-slate-600">{{ lead.primaryPhone }}</p>
              </div>
              <button
                type="button"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition-colors"
                style="min-height: var(--spacing-touch)"
                :class="lead.isHot
                  ? 'bg-amber-50 text-amber-900 ring-amber-800'
                  : 'bg-white text-slate-700 ring-slate-500 hover:bg-slate-50'"
                :aria-pressed="lead.isHot"
                :aria-label="t('leadDetail.hot')"
                @click="toggleHot"
              >
                <svg class="size-3.5" viewBox="0 0 24 24" aria-hidden="true" :fill="lead.isHot ? 'currentColor' : 'none'">
                  <path
                    d="M12 2.5 14.5 9h6.2l-5 3.9 1.9 6.4L12 15.8 6.4 19.3 8.3 12.9l-5-3.9h6.2L12 2.5Z"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                </svg>
                {{ t('leadDetail.hot') }}
              </button>
            </div>
            <span
              class="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset"
              :class="dueBadgeClass"
            >
              {{ dueLabel }}
            </span>
          </div>
        </div>

        <dl class="grid grid-cols-1 divide-y divide-slate-100 border-t border-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div class="px-5 py-3 sm:px-6">
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('leadDetail.event') }}</dt>
            <dd class="mt-1 text-sm font-medium text-slate-900">
              <template v-if="lead.eventType">
                {{ t(`eventType.${lead.eventType}`) }}
                <span v-if="lead.eventDate"> · {{ formatDate(lead.eventDate) }}</span>
              </template>
              <template v-else>{{ t('leadDetail.noEvent') }}</template>
            </dd>
          </div>
          <div class="px-5 py-3 sm:px-6">
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('leadDetail.source') }}</dt>
            <dd class="mt-1 text-sm font-medium text-slate-900">
              {{ lead.source ? t(`source.${lead.source}`) : t('common.none') }}
            </dd>
          </div>
          <div class="px-5 py-3 sm:px-6">
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('leadDetail.owner') }}</dt>
            <dd class="mt-1 truncate text-sm font-medium text-slate-900">{{ ownerName }}</dd>
          </div>
        </dl>

        <div class="flex flex-wrap gap-2 border-t border-slate-100 p-4 sm:px-6">
          <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary shrink-0 text-sm">
            {{ t('lead.call') }}
          </a>
          <a
            :href="toWhatsAppLink(lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName }))"
            target="_blank"
            rel="noopener"
            class="btn-whatsapp shrink-0 text-sm"
          >
            {{ t('lead.whatsapp') }}
          </a>
          <button type="button" class="btn-secondary shrink-0 text-sm" @click="activeDialog = { type: 'log' }">
            {{ t('leadDetail.logActivity') }}
          </button>
          <button type="button" class="btn-ghost shrink-0 text-sm" @click="activeDialog = { type: 'snooze' }">
            {{ t('leadDetail.snoozeAction') }}
          </button>
          <button
            v-if="auth.can.reassignLead"
            type="button"
            class="btn-ghost shrink-0 text-sm"
            @click="activeDialog = { type: 'reassign' }"
          >
            {{ t('leadDetail.reassign') }}
          </button>
        </div>
      </section>

      <section class="mt-6">
        <div class="flex items-center justify-between gap-3">
          <h2 class="section-label">{{ t('leadDetail.deals') }}</h2>
          <button
            type="button"
            class="btn-ghost shrink-0 text-sm"
            @click="activeDialog = { type: 'addProduct' }"
          >
            <svg class="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
            {{ t('leadDetail.addProduct') }}
          </button>
        </div>

        <div v-if="!deals.length" class="card mt-3 rounded-2xl px-6 py-10 text-center">
          <p class="text-base font-semibold text-slate-900">{{ t('leadDetail.noDeals') }}</p>
          <p class="mt-1 text-sm text-slate-600">{{ t('leadDetail.noDealsBody') }}</p>
          <button type="button" class="btn-primary mt-5" @click="activeDialog = { type: 'addProduct' }">
            {{ t('leadDetail.addProduct') }}
          </button>
        </div>

        <ul v-else class="mt-3 grid gap-3 lg:grid-cols-2">
          <li v-for="deal in deals" :key="deal.id" class="card rounded-2xl p-4">
            <div class="flex items-start justify-between gap-2">
              <p class="font-semibold text-slate-900">{{ t(`productType.${deal.productType}`) }}</p>
              <span class="badge shrink-0" :class="DEAL_BADGE_CLASS[deal.status]">
                {{ t(`dealStatus.${deal.status}`) }}
              </span>
            </div>
            <p v-if="deal.status === 'closed_lost' && deal.lostReason" class="mt-2 text-sm text-slate-600">
              {{ t('detail.lossReason') }} — {{ t(`lossReason.${deal.lostReason}`) }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <template v-if="deal.status === 'open'">
                <button type="button" class="btn-secondary shrink-0 text-sm" @click="markWon(deal)">
                  {{ t('leadDetail.closeWon') }}
                </button>
                <button
                  type="button"
                  class="btn-secondary shrink-0 text-sm"
                  @click="activeDialog = { type: 'closeLost', dealId: deal.id }"
                >
                  {{ t('leadDetail.closeLost') }}
                </button>
              </template>
              <button
                v-else-if="auth.isManager"
                type="button"
                class="btn-ghost shrink-0 text-sm"
                @click="reopenDeal(deal)"
              >
                {{ t('leadDetail.reopen') }}
              </button>
              <button
                v-if="auth.can.deleteLead"
                type="button"
                class="btn-ghost shrink-0 text-sm text-rose-700"
                @click="removeDeal(deal)"
              >
                {{ t('leadDetail.removeDeal') }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="mt-6">
        <h2 class="section-label">{{ t('detail.timeline') }}</h2>

        <div v-if="!activities.length" class="card mt-3 rounded-2xl px-6 py-10 text-center">
          <p class="text-sm text-slate-600">{{ t('detail.noActivity') }}</p>
        </div>

        <ul v-else class="mt-3 space-y-3">
          <li
            v-for="a in activities"
            :key="a.id"
            class="card rounded-2xl p-4"
            :class="a.isVoided ? 'bg-slate-50' : ''"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium text-slate-800">
                {{ t(`channel.${a.channel}`) }}
                <template v-if="a.outcome"> · {{ t(outcomeMessageKey(a.outcome)) }}</template>
              </span>
              <span class="text-sm tabular-nums text-slate-600">{{ formatDateTime(a.at) }}</span>
            </div>
            <p v-if="a.dealId" class="mt-1 text-xs font-semibold text-brand-800">{{ dealLabel(a.dealId) }}</p>
            <p class="mt-2 text-sm text-slate-800" :class="a.isVoided ? 'text-slate-500 line-through' : ''">
              {{ a.summary || t('common.none') }}
            </p>
            <p class="mt-1 text-sm text-slate-600">{{ a.byUserName }}</p>

            <p v-if="a.isVoided" class="mt-2 text-sm text-rose-800">
              {{ t('detail.voided', { reason: a.voidReason }) }}
            </p>

            <template v-else-if="voidingId === a.id">
              <div class="mt-3 space-y-2">
                <p class="text-sm text-slate-600">{{ t('detail.correctPrompt') }}</p>
                <input
                  v-model="voidReason"
                  type="text"
                  class="field-input"
                  :placeholder="t('detail.correctPlaceholder')"
                />
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn-danger text-sm" @click="confirmVoid(a)">
                    {{ t('detail.correctConfirm') }}
                  </button>
                  <button type="button" class="btn-ghost text-sm" @click="cancelVoid">
                    {{ t('common.cancel') }}
                  </button>
                </div>
              </div>
            </template>

            <button
              v-else
              type="button"
              class="btn-ghost mt-2 text-sm"
              @click="startVoid(a)"
            >
              {{ t('detail.correct') }}
            </button>
          </li>
        </ul>

        <button
          v-if="hasMore"
          type="button"
          class="btn-secondary mt-3 w-full"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ t('leads.loadMore') }}
        </button>
      </section>

      <section v-if="auth.can.deleteLead" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-rose-800">
          {{ t('deleteLead.dangerZone') }}
        </h2>
        <div class="mt-2 rounded-2xl bg-rose-50 p-5 ring-1 ring-rose-700 ring-inset">
          <p class="text-sm text-rose-950">{{ t('deleteLead.dangerHelp') }}</p>
          <button
            type="button"
            class="btn-danger mt-4 text-sm"
            @click="activeDialog = { type: 'delete' }"
          >
            {{ t('deleteLead.action') }}
          </button>
        </div>
      </section>

      <LogActivityDialog
        v-if="activeDialog?.type === 'log'"
        :lead-id="leadId"
        @close="closeDialog"
        @saved="closeDialog"
      />
      <SnoozeDialog
        v-if="activeDialog?.type === 'snooze'"
        :lead-id="leadId"
        @close="closeDialog"
        @saved="closeDialog"
      />
      <CloseLostDialog
        v-if="activeDialog?.type === 'closeLost'"
        :lead-id="leadId"
        :deal-id="activeDialog.dealId"
        @close="closeDialog"
        @saved="closeDialog"
      />
      <ReassignDialog
        v-if="activeDialog?.type === 'reassign'"
        :lead="lead"
        @close="closeDialog"
        @saved="closeDialog"
      />
      <DeleteLeadDialog
        v-if="activeDialog?.type === 'delete'"
        :lead="lead"
        :deal-count="deals.length"
        :activity-count="activities.length"
        @close="closeDialog"
        @deleted="onLeadDeleted"
      />
      <Modal v-if="activeDialog?.type === 'addProduct'" title-key="leadDetail.addProductTitle" @close="closeDialog">
        <p v-if="!availableProducts.length" class="text-sm text-slate-600">
          {{ t('leadDetail.addProductEmpty') }}
        </p>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="p in availableProducts"
            :key="p"
            type="button"
            class="btn-secondary w-full justify-start"
            @click="addProduct(p)"
          >
            {{ t(`productType.${p}`) }}
          </button>
        </div>
      </Modal>
    </template>
  </div>
</template>
