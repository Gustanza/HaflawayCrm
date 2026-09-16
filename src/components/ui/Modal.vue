<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  titleKey: { type: String, required: true },
})
const emit = defineEmits(['close'])
const { t } = useI18n()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
    <div class="absolute inset-0 bg-slate-900/50" @click="emit('close')" />
    <div class="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900">{{ t(titleKey) }}</h2>
        <button
          type="button"
          class="icon-btn -mr-2 -mt-2 shrink-0"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <div class="mt-4">
        <slot />
      </div>
    </div>
  </div>
</template>
