<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import Modal from '@/components/ui/Modal.vue'

const props = defineProps({
  lead: { type: Object, required: true },
  dealCount: { type: Number, default: 0 },
  activityCount: { type: Number, default: 0 },
})
const emit = defineEmits(['close', 'deleted'])

const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const displayName = computed(() => props.lead.displayName || t('lead.unnamed'))

const reason = ref('')
const typedName = ref('')
const deleting = ref(false)
const step = ref(null)
const submitted = ref(false)

const nameMatches = computed(
  () => typedName.value.trim().toLowerCase() === displayName.value.trim().toLowerCase(),
)
const canConfirm = computed(() => reason.value.trim().length > 0 && nameMatches.value)

const STEP_KEYS = ['deals', 'activities', 'phoneIndex', 'lead']
const buttonLabel = computed(() => {
  if (!deleting.value) return t('deleteLead.confirm')
  if (step.value && STEP_KEYS.includes(step.value)) return t(`deleteLead.step.${step.value}`)
  return t('deleteLead.deleting')
})

async function onConfirm() {
  submitted.value = true
  if (!canConfirm.value || deleting.value) return

  deleting.value = true
  try {
    await leadsStore.deleteLead(props.lead, ({ step: s }) => {
      step.value = s
    })
    ui.success(t('deleteLead.done'))
    emit('deleted')
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  } finally {
    deleting.value = false
    step.value = null
  }
}
</script>

<template>
  <Modal title-key="deleteLead.title" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-sm text-slate-700">{{ t('deleteLead.subtitle', { name: displayName }) }}</p>

      <div>
        <p class="text-sm font-medium text-slate-800">{{ t('deleteLead.willRemove') }}</p>
        <ul class="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>{{ t('deleteLead.theLead') }}</li>
          <li>{{ t('deleteLead.count.deals', { count: dealCount }) }}</li>
          <li>{{ t('deleteLead.count.activities', { count: activityCount }) }}</li>
          <li>{{ t('deleteLead.phoneLock') }}</li>
        </ul>
      </div>

      <p class="text-sm font-medium text-rose-700">{{ t('deleteLead.irreversible') }}</p>

      <div>
        <label class="field-label" for="delete-lead-reason">{{ t('deleteLead.reason') }}</label>
        <input
          id="delete-lead-reason"
          v-model="reason"
          type="text"
          class="field-input"
          :placeholder="t('deleteLead.reasonPlaceholder')"
        />
        <p class="mt-1 text-xs text-slate-500">{{ t('deleteLead.reasonHelp') }}</p>
        <p v-if="submitted && !reason.trim()" class="field-error">{{ t('common.required') }}</p>
      </div>

      <div>
        <label class="field-label" for="delete-lead-confirm">
          {{ t('deleteLead.typeName', { name: displayName }) }}
        </label>
        <input id="delete-lead-confirm" v-model="typedName" type="text" class="field-input" />
        <p v-if="submitted && !nameMatches" class="field-error">{{ t('common.required') }}</p>
      </div>

      <p v-if="!ui.isOnline" class="text-sm text-amber-700">{{ t('deleteLead.offline') }}</p>

      <button
        type="button"
        class="btn-danger w-full"
        :disabled="deleting || !ui.isOnline"
        @click="onConfirm"
      >
        {{ buttonLabel }}
      </button>
    </div>
  </Modal>
</template>
