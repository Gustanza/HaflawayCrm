<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import Modal from '@/components/ui/Modal.vue'
import FollowUpPicker from '@/components/leads/FollowUpPicker.vue'

const props = defineProps({
  leadId: { type: String, required: true },
})
const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const nextFollowUpAt = ref(null)
const submitted = ref(false)

function onSave() {
  submitted.value = true
  if (!nextFollowUpAt.value) return
  // Optimistic — no spinner, the caller closes the dialog immediately.
  ui.trackWrite(leadsStore.setNextFollowUp(props.leadId, nextFollowUpAt.value), {
    onError: (error) => ui.error(t(writeErrorKey(error))),
  })
  emit('saved')
}
</script>

<template>
  <Modal title-key="activity.remindMe" @close="emit('close')">
    <FollowUpPicker v-model="nextFollowUpAt" />
    <p v-if="submitted && !nextFollowUpAt" class="field-error">
      {{ t('activity.nextFollowUpRequired') }}
    </p>
    <button type="button" class="btn-primary mt-4 w-full" @click="onSave">
      {{ t('common.save') }}
    </button>
  </Modal>
</template>
