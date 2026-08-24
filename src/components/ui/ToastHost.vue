<script setup>
/**
 * Toast outlet. Errors stay until dismissed (see stores/ui.js) because a failed save
 * that scrolls away silently is how an agent loses a lead's notes.
 */
import { useUiStore } from '@/stores/ui.js'

import { computed } from 'vue'

const ui = useUiStore()

// Removing the per-toast role="alert" fixed the nested-live-region problem but downgraded
// every error to polite, so a failed save queued behind whatever was already being read.
const hasError = computed(() => ui.toasts.some((t) => t.type === 'error'))

const STYLES = {
  success: 'bg-emerald-700 text-white',
  error: 'bg-rose-600 text-white',
  warning: 'bg-amber-500 text-amber-950',
  info: 'bg-slate-800 text-white',
}
</script>

<template>
  <div
    class="fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none
           md:bottom-6"
    :style="{ bottom: 'max(1.5rem, calc(6.5rem + env(safe-area-inset-bottom)))' }"
    :aria-live="hasError ? 'assertive' : 'polite'"
    aria-atomic="false"
  >
    <TransitionGroup name="toast">
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="pointer-events-auto w-full max-w-md rounded-lg px-4 py-3 shadow-lg flex items-center gap-3"
        :class="STYLES[t.type]"
      >
        <p class="flex-1 text-sm">{{ t.message }}</p>
        <button
          v-if="t.action"
          type="button"
          class="shrink-0 px-3 text-sm font-semibold underline grid place-items-center"
          style="min-height: var(--spacing-touch)"
          @click="t.action.handler(); ui.dismiss(t.id)"
        >
          {{ t.action.label }}
        </button>
        <button
          type="button"
          class="shrink-0 grid place-items-center opacity-80 hover:opacity-100 -my-1"
          style="min-height: var(--spacing-touch); min-width: var(--spacing-touch)"
          :aria-label="$t('common.close')"
          @click="ui.dismiss(t.id)"
        >
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
