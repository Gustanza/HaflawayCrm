<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { useUserNames } from '@/composables/useUserNames.js'
import { toDate } from '@/domain/periods.js'
import { toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { PRODUCT_TYPES, outcomeMessageKey } from '@/domain/taxonomies.js'
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

const leadId = computed(() => route.params.id)

const { item: lead, loaded: leadLoaded } = leadsStore.lead(leadId.value)
const { items: deals } = leadsStore.deals(leadId.value)
const { items: activities, hasMore, loadMore, loadingMore } = leadsStore.timeline(leadId.value)

const { names } = useUserNames(() => auth.orgId)
const ownerName = computed(() => names.value.get(lead.value?.ownerId) ?? lead.value?.ownerId ?? '')

const displayName = computed(() => lead.value?.displayName || t('lead.unnamed'))

const openDeals = computed(() => deals.value.filter((d) => d.status === 'open'))
const openProductTypes = computed(() => openDeals.value.map((d) => d.productType))
const availableProducts = computed(() => PRODUCT_TYPES.filter((p) => !openProductTypes.value.includes(p)))

const DEAL_BADGE_CLASS = {
  open: 'bg-slate-100 text-slate-700 ring-slate-300',
  closed_won: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  closed_lost: 'bg-rose-50 text-rose-700 ring-rose-300',
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
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div v-if="leadLoaded && !lead" class="py-10 text-center text-sm text-slate-600">
      {{ t('detail.notFound') }}
    </div>

    <template v-else-if="lead">
      <!-- Header -->
      <div class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-slate-900">{{ displayName }}</h1>
            <p class="text-sm text-slate-600">{{ lead.primaryPhone }}</p>
          </div>
          <button
            type="button"
            class="icon-btn shrink-0 text-xl"
            :class="lead.isHot ? 'text-amber-500' : 'text-slate-300'"
            :aria-label="t('leadDetail.hot')"
            @click="toggleHot"
          >
            🔥
          </button>
        </div>

        <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt class="text-slate-500">{{ t('leadDetail.event') }}</dt>
            <dd class="text-slate-800">
              <template v-if="lead.eventType">
                {{ t(`eventType.${lead.eventType}`) }}
                <span v-if="lead.eventDate"> · {{ formatDate(lead.eventDate) }}</span>
              </template>
              <template v-else>{{ t('leadDetail.noEvent') }}</template>
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('leadDetail.source') }}</dt>
            <dd class="text-slate-800">{{ lead.source ? t(`source.${lead.source}`) : t('common.none') }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('leadDetail.owner') }}</dt>
            <dd class="text-slate-800">{{ ownerName }}</dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2">
          <a :href="toTelLink(lead.primaryPhone)" class="btn-secondary text-sm">{{ t('lead.call') }}</a>
          <a
            :href="toWhatsAppLink(lead.primaryPhone, t('lead.whatsappGreeting', { name: displayName }))"
            target="_blank"
            rel="noopener"
            class="btn-secondary text-sm"
          >
            {{ t('lead.whatsapp') }}
          </a>
          <button type="button" class="btn-secondary text-sm" @click="activeDialog = { type: 'log' }">
            {{ t('leadDetail.logActivity') }}
          </button>
          <button type="button" class="btn-ghost text-sm" @click="activeDialog = { type: 'snooze' }">
            {{ t('leadDetail.snoozeAction') }}
          </button>
          <button
            v-if="auth.can.reassignLead"
            type="button"
            class="btn-ghost text-sm"
            @click="activeDialog = { type: 'reassign' }"
          >
            {{ t('leadDetail.reassign') }}
          </button>
        </div>
      </div>

      <!-- Deals -->
      <section class="mt-6">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('leadDetail.deals') }}</h2>
          <button
            type="button"
            class="text-sm font-medium text-brand-700 hover:underline"
            @click="activeDialog = { type: 'addProduct' }"
          >
            + {{ t('leadDetail.addProduct') }}
          </button>
        </div>

        <div v-if="!deals.length" class="mt-2 card p-4 text-sm text-slate-600">
          <p class="font-medium text-slate-800">{{ t('leadDetail.noDeals') }}</p>
          <p class="mt-1">{{ t('leadDetail.noDealsBody') }}</p>
        </div>

        <ul v-else class="mt-2 space-y-2">
          <li v-for="deal in deals" :key="deal.id" class="card p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="font-medium text-slate-900">{{ t(`productType.${deal.productType}`) }}</p>
              <span class="badge" :class="DEAL_BADGE_CLASS[deal.status]">
                {{ t(`dealStatus.${deal.status}`) }}
              </span>
            </div>
            <p v-if="deal.status === 'closed_lost' && deal.lostReason" class="mt-1 text-sm text-slate-600">
              {{ t('detail.lossReason') }} — {{ t(`lossReason.${deal.lostReason}`) }}
            </p>

            <div class="mt-2.5 flex flex-wrap gap-2">
              <template v-if="deal.status === 'open'">
                <button type="button" class="btn-secondary text-sm" @click="markWon(deal)">
                  {{ t('leadDetail.closeWon') }}
                </button>
                <button
                  type="button"
                  class="btn-secondary text-sm"
                  @click="activeDialog = { type: 'closeLost', dealId: deal.id }"
                >
                  {{ t('leadDetail.closeLost') }}
                </button>
              </template>
              <button
                v-else-if="auth.isManager"
                type="button"
                class="btn-ghost text-sm"
                @click="reopenDeal(deal)"
              >
                {{ t('leadDetail.reopen') }}
              </button>
              <button
                v-if="auth.can.deleteLead"
                type="button"
                class="btn-ghost text-sm text-rose-600"
                @click="removeDeal(deal)"
              >
                {{ t('leadDetail.removeDeal') }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Timeline -->
      <section class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('detail.timeline') }}</h2>

        <p v-if="!activities.length" class="mt-2 text-sm text-slate-600">{{ t('detail.noActivity') }}</p>

        <ul v-else class="mt-2 space-y-2">
          <li v-for="a in activities" :key="a.id" class="card p-3" :class="a.isVoided ? 'opacity-60' : ''">
            <div class="flex items-center justify-between gap-2 text-sm text-slate-500">
              <span>{{ t(`channel.${a.channel}`) }}<template v-if="a.outcome"> · {{ t(outcomeMessageKey(a.outcome)) }}</template></span>
              <span>{{ formatDateTime(a.at) }}</span>
            </div>
            <p v-if="a.dealId" class="mt-1 text-xs font-medium text-brand-700">{{ dealLabel(a.dealId) }}</p>
            <p class="mt-1 text-sm text-slate-800" :class="a.isVoided ? 'line-through' : ''">
              {{ a.summary || t('common.none') }}
            </p>
            <p class="mt-1 text-xs text-slate-500">{{ a.byUserName }}</p>

            <p v-if="a.isVoided" class="mt-1 text-xs text-rose-600">
              {{ t('detail.voided', { reason: a.voidReason }) }}
            </p>

            <template v-else-if="voidingId === a.id">
              <div class="mt-2 space-y-2">
                <p class="text-xs text-slate-600">{{ t('detail.correctPrompt') }}</p>
                <input
                  v-model="voidReason"
                  type="text"
                  class="field-input"
                  :placeholder="t('detail.correctPlaceholder')"
                />
                <div class="flex gap-2">
                  <button type="button" class="btn-danger text-sm" @click="confirmVoid(a)">
                    {{ t('detail.correctConfirm') }}
                  </button>
                  <button type="button" class="btn-ghost text-sm" @click="cancelVoid">
                    {{ t('common.cancel') }}
                  </button>
                </div>
              </div>
            </template>

            <button v-else type="button" class="mt-2 text-xs font-medium text-slate-500 hover:underline" @click="startVoid(a)">
              {{ t('detail.correct') }}
            </button>
          </li>
        </ul>

        <button
          v-if="hasMore"
          type="button"
          class="btn-secondary mt-3 w-full text-sm"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ t('leads.loadMore') }}
        </button>
      </section>

      <!-- Danger zone -->
      <section v-if="auth.can.deleteLead" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-rose-600">
          {{ t('deleteLead.dangerZone') }}
        </h2>
        <div class="card mt-2 p-4">
          <p class="text-sm text-slate-600">{{ t('deleteLead.dangerHelp') }}</p>
          <button
            type="button"
            class="btn-danger mt-3 text-sm"
            @click="activeDialog = { type: 'delete' }"
          >
            {{ t('deleteLead.action') }}
          </button>
        </div>
      </section>

      <LogActivityDialog
        v-if="activeDialog?.type === 'log'"
        :lead-id="leadId"
        :deal-options="openDeals"
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
