<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { CHANNELS, CALL_OUTCOMES, outcomeMessageKey } from '@/domain/taxonomies.js'
import Modal from '@/components/ui/Modal.vue'
import FollowUpPicker from '@/components/leads/FollowUpPicker.vue'

const props = defineProps({
  leadId: { type: String, required: true },
  dealOptions: { type: Array, default: () => [] }, // [{ id, productType }]
})
const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const channel = ref('call')
const outcome = ref('spoke')
const summary = ref('')
const dealId = ref('')
const nextFollowUpAt = ref(null)
const saving = ref(false)
const submitted = ref(false)

async function onSubmit() {
  submitted.value = true
  if (!nextFollowUpAt.value) return

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
    ui.success(t('activity.saved'))
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

      <div v-if="dealOptions.length">
        <label for="log-deal" class="field-label">{{ t('activity.linkedDeal') }}</label>
        <select id="log-deal" v-model="dealId" class="field-input">
          <option value="">{{ t('activity.linkedDealNone') }}</option>
          <option v-for="d in dealOptions" :key="d.id" :value="d.id">
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

      <div>
        <p class="field-label">{{ t('activity.remindMe') }}</p>
        <FollowUpPicker v-model="nextFollowUpAt" />
        <p v-if="submitted && !nextFollowUpAt" class="field-error">
          {{ t('activity.nextFollowUpRequired') }}
        </p>
      </div>

      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.loading') : t('activity.save') }}
      </button>
    </form>
  </Modal>
</template>
