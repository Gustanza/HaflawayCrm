<script setup>
/**
 * Honest connectivity status (TODO.md P8). Offline is normal, so this is calm and
 * informative rather than an alarm: the agent's work is safe on the device.
 *
 * The wrapper is ALWAYS in the DOM. A live region that is created by v-if at the same
 * moment its content appears is announced by almost no screen reader — the region has to
 * exist before the text changes.
 */
import { useUiStore } from '@/stores/ui.js'

const ui = useUiStore()
</script>

<template>
  <div role="status" aria-live="polite" class="empty:hidden">
    <div
      v-if="!ui.isOnline"
      class="bg-amber-500 text-amber-950 px-4 py-2 text-sm font-medium text-center"
    >
      {{ $t('offline.banner') }}
      <span v-if="ui.hasPendingWrites">
        {{ $t('offline.pending', { count: ui.pendingWrites }) }}
      </span>
    </div>

    <!-- Confirm the queue is flushing, rather than letting the banner vanish silently. -->
    <div
      v-else-if="ui.justReconnected"
      class="bg-emerald-700 text-white px-4 py-2 text-sm font-medium text-center"
    >
      {{ ui.hasPendingWrites ? $t('offline.restored') : $t('offline.synced') }}
    </div>
  </div>
</template>
