<script setup>
import { useUiStore } from '@/stores/ui.js'

const ui = useUiStore()

const TYPE_CLASSES = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-slate-900 text-white',
}
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pointer-events-none sm:items-end"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="item in ui.toasts"
        :key="item.id"
        class="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg px-4 py-3 shadow-lg"
        :class="TYPE_CLASSES[item.type] ?? TYPE_CLASSES.info"
        role="status"
      >
        <p class="flex-1 text-sm">{{ item.message }}</p>
        <button
          type="button"
          class="shrink-0 text-sm font-medium opacity-80 hover:opacity-100"
          @click="ui.dismiss(item.id)"
        >
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
