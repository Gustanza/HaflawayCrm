<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { QUICK_CHIPS, resolveQuickChip } from '@/domain/followUp.js'

const props = defineProps({
  modelValue: { type: Date, default: null },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const CHIP_LABEL_KEY = {
  '2h': 'snooze.twoHours',
  tomorrow9am: 'snooze.tomorrow',
  '3d': 'snooze.threeDays',
  '1w': 'snooze.oneWeek',
}

const selectedChip = ref(null)
const showCustom = ref(false)

/** yyyy-MM-ddThh:mm in the browser's own local time — what <input type="datetime-local"> needs. */
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const customValue = computed({
  get() {
    return props.modelValue ? toLocalInputValue(props.modelValue) : ''
  },
  set(value) {
    if (!value) return
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      selectedChip.value = null
      emit('update:modelValue', d)
    }
  },
})

function pickChip(chip) {
  const resolved = resolveQuickChip(chip)
  if (!resolved) return
  selectedChip.value = chip
  showCustom.value = false
  emit('update:modelValue', resolved)
}

function pickCustom() {
  showCustom.value = true
  selectedChip.value = null
}
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="chip in QUICK_CHIPS"
        :key="chip"
        type="button"
        class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors"
        style="min-height: var(--spacing-touch)"
        :class="selectedChip === chip
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
        @click="pickChip(chip)"
      >
        {{ t(CHIP_LABEL_KEY[chip]) }}
      </button>
      <button
        type="button"
        class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors"
        style="min-height: var(--spacing-touch)"
        :class="showCustom
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
        @click="pickCustom"
      >
        {{ t('snooze.custom') }}
      </button>
    </div>

    <div v-if="showCustom" class="mt-3">
      <label for="followup-custom" class="field-label">{{ t('snooze.customLabel') }}</label>
      <input id="followup-custom" v-model="customValue" type="datetime-local" class="field-input" />
    </div>
  </div>
</template>
