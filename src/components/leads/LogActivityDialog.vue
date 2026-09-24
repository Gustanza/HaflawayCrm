<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { CHANNELS, CALL_OUTCOMES, PRODUCT_TYPES, LOST_REASONS, outcomeMessageKey } from '@/domain/taxonomies.js'
import { describeFollowUp } from '@/domain/followUp.js'
import Modal from '@/components/ui/Modal.vue'
import FollowUpPicker from '@/components/leads/FollowUpPicker.vue'

const props = defineProps({
  leadId: { type: String, required: true },
})
const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

// Loaded here rather than passed in, so the "closed a deal?" section works the same from
// the Work Queue as from Lead Detail.
const { items: deals } = leadsStore.deals(props.leadId)
const openDeals = computed(() => deals.value.filter((d) => d.status === 'open'))
const openProductTypes = computed(() => new Set(openDeals.value.map((d) => d.productType)))

// Products this lead is already discussing come first — those are the likely ones.
const productRows = computed(() => [
  ...PRODUCT_TYPES.filter((p) => openProductTypes.value.has(p)),
  ...PRODUCT_TYPES.filter((p) => !openProductTypes.value.has(p)),
])

const channel = ref('call')
const outcome = ref('spoke')
const summary = ref('')
const dealId = ref('')
const nextFollowUpAt = ref(null)
const saving = ref(false)
const submitted = ref(false)

/** productType → 'closed_won' | 'closed_lost' */
const dealResults = ref({})
/** productType → lost reason */
const lostReasons = ref({})

const closingAny = computed(() => Object.keys(dealResults.value).length > 0)
const missingLostReason = computed(() =>
  Object.entries(dealResults.value).some(([p, s]) => s === 'closed_lost' && !lostReasons.value[p]),
)

function toggleResult(productType, status) {
  const next = { ...dealResults.value }
  if (next[productType] === status) delete next[productType]
  else next[productType] = status
  dealResults.value = next
}

async function onSubmit() {
  submitted.value = true
  if (!nextFollowUpAt.value && !closingAny.value) return
  if (missingLostReason.value) return

  saving.value = true
  try {
    await leadsStore.logActivity({
      leadId: props.leadId,
      channel: channel.value,
      outcome: outcome.value,
      summary: summary.value,
      dealId: dealId.value || null,
      nextFollowUpAt: nextFollowUpAt.value,
    })

    const results = Object.entries(dealResults.value)
    for (const [productType, status] of results) {
      await leadsStore.recordDealOutcome({
        leadId: props.leadId,
        openDeals: openDeals.value,
        productType,
        status,
        lostReason: status === 'closed_lost' ? lostReasons.value[productType] : null,
      })
    }

    const won = results.filter(([, s]) => s === 'closed_won').map(([p]) => t(`productType.${p}`))
    const next = describeFollowUp(nextFollowUpAt.value)
    if (won.length) ui.success(t('activity.savedWon', { products: won.join(', ') }))
    else if (next) ui.success(t('activity.saved', { when: t(`nextAction.${next.key}`, { count: next.count }) }))
    else ui.success(t('common.saved'))
    emit('saved')
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal title-key="activity.title" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="onSubmit">
      <div>
        <label for="log-channel" class="field-label">{{ t('activity.channel') }}</label>
        <select id="log-channel" v-model="channel" class="field-input">
          <option v-for="c in CHANNELS" :key="c" :value="c">{{ t(`channel.${c}`) }}</option>
        </select>
      </div>

      <div>
        <label for="log-outcome" class="field-label">{{ t('activity.whatHappened') }}</label>
        <select id="log-outcome" v-model="outcome" class="field-input">
          <option v-for="o in CALL_OUTCOMES" :key="o" :value="o">{{ t(outcomeMessageKey(o)) }}</option>
        </select>
      </div>

      <div v-if="openDeals.length">
        <label for="log-deal" class="field-label">{{ t('activity.linkedDeal') }}</label>
        <select id="log-deal" v-model="dealId" class="field-input">
          <option value="">{{ t('activity.linkedDealNone') }}</option>
          <option v-for="d in openDeals" :key="d.id" :value="d.id">
            {{ t(`productType.${d.productType}`) }}
          </option>
        </select>
      </div>

      <div>
        <label for="log-summary" class="field-label">
          {{ t('activity.note') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
        </label>
        <textarea
          id="log-summary"
          v-model="summary"
          rows="3"
          class="field-input"
          style="min-height: 5.5rem"
          :placeholder="t('activity.notePlaceholder')"
        />
      </div>

      <fieldset>
        <legend class="field-label">
          {{ t('activity.closedDeal') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
        </legend>
        <ul class="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          <li v-for="p in productRows" :key="p" class="px-3 py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 text-sm text-slate-800">
                {{ t(`productType.${p}`) }}
                <span v-if="openProductTypes.has(p)" class="text-xs text-slate-500">· {{ t('activity.inProgress') }}</span>
              </span>
              <div class="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors"
                  :class="dealResults[p] === 'closed_won'
                    ? 'bg-emerald-700 text-white ring-emerald-700'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
                  :aria-pressed="dealResults[p] === 'closed_won'"
                  @click="toggleResult(p, 'closed_won')"
                >
                  {{ t('activity.won') }}
                </button>
                <button
                  type="button"
                  class="rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors"
                  :class="dealResults[p] === 'closed_lost'
                    ? 'bg-rose-700 text-white ring-rose-700'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
                  :aria-pressed="dealResults[p] === 'closed_lost'"
                  @click="toggleResult(p, 'closed_lost')"
                >
                  {{ t('activity.lost') }}
                </button>
              </div>
            </div>
            <div v-if="dealResults[p] === 'closed_lost'" class="mt-2">
              <select v-model="lostReasons[p]" class="field-input" :aria-label="t('detail.lossReason')">
                <option :value="undefined">{{ t('detail.lossReason') }}…</option>
                <option v-for="r in LOST_REASONS" :key="r" :value="r">{{ t(`lossReason.${r}`) }}</option>
              </select>
              <p v-if="submitted && !lostReasons[p]" class="field-error">{{ t('common.required') }}</p>
            </div>
          </li>
        </ul>
      </fieldset>

      <div>
        <p class="field-label">
          {{ t('activity.remindMe') }}
          <span v-if="closingAny" class="text-slate-400">({{ t('common.optional') }})</span>
        </p>
        <FollowUpPicker v-model="nextFollowUpAt" />
        <p v-if="closingAny && !nextFollowUpAt" class="mt-1.5 text-sm text-slate-500">
          {{ t('activity.closingSkipsFollowUp') }}
        </p>
        <p v-else-if="submitted && !nextFollowUpAt" class="field-error">
          {{ t('activity.nextFollowUpRequired') }}
        </p>
      </div>

      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.loading') : t('activity.save') }}
      </button>
    </form>
  </Modal>
</template>
