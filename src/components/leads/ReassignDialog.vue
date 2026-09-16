<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { useUserNames } from '@/composables/useUserNames.js'
import Modal from '@/components/ui/Modal.vue'

const props = defineProps({
  lead: { type: Object, required: true },
})
const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const auth = useAuthStore()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const { names } = useUserNames(() => auth.orgId)
const options = computed(() =>
  Array.from(names.value, ([id, displayName]) => ({ id, displayName: displayName || id }))
    .filter((u) => u.id !== props.lead.ownerId),
)

const toUserId = ref('')
const saving = ref(false)
const submitted = ref(false)

async function onSubmit() {
  submitted.value = true
  if (!toUserId.value) return
  saving.value = true
  try {
    await leadsStore.reassignLead(props.lead, toUserId.value)
    const name = options.value.find((u) => u.id === toUserId.value)?.displayName ?? toUserId.value
    ui.success(t('leadDetail.reassigned', { name }))
    emit('saved')
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal title-key="leadDetail.reassignTitle" @close="emit('close')">
    <p class="text-sm text-slate-600">{{ t('leadDetail.reassignHint') }}</p>
    <form class="mt-4 space-y-4" @submit.prevent="onSubmit">
      <select v-model="toUserId" class="field-input">
        <option value="">{{ t('common.select') }}</option>
        <option v-for="u in options" :key="u.id" :value="u.id">{{ u.displayName }}</option>
      </select>
      <p v-if="submitted && !toUserId" class="field-error">{{ t('common.required') }}</p>

      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.loading') : t('leadDetail.reassignSave') }}
      </button>
    </form>
  </Modal>
</template>
