<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { LOST_REASONS } from '@/domain/taxonomies.js'
import Modal from '@/components/ui/Modal.vue'

const props = defineProps({
  leadId: { type: String, required: true },
  dealId: { type: String, required: true },
})
const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const lostReason = ref('')
const saving = ref(false)
const submitted = ref(false)

async function onSubmit() {
  submitted.value = true
  if (!lostReason.value) return
  saving.value = true
  try {
    await leadsStore.closeDeal(props.leadId, props.dealId, 'closed_lost', lostReason.value)
    emit('saved')
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal title-key="detail.lossReason" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="onSubmit">
      <select v-model="lostReason" class="field-input">
        <option value="">{{ t('common.select') }}</option>
        <option v-for="r in LOST_REASONS" :key="r" :value="r">{{ t(`lossReason.${r}`) }}</option>
      </select>
      <p v-if="submitted && !lostReason" class="field-error">{{ t('common.required') }}</p>

      <button type="submit" class="btn-danger w-full" :disabled="saving">
        {{ saving ? t('common.loading') : t('leadDetail.closeLost') }}
      </button>
    </form>
  </Modal>
</template>
