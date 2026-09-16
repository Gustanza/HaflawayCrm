<script setup>
import { useUiStore } from '@/stores/ui.js'

const ui = useUiStore()
</script>

<template>
  <div
    v-if="!ui.isOnline"
    class="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white"
    role="status"
  >
    <span aria-hidden="true">⚠</span>
    <span>{{ $t('offline.banner') }}</span>
    <span v-if="ui.hasPendingWrites">
      — {{ $t('offline.pending', { count: ui.pendingWrites }) }}
    </span>
  </div>
  <div
    v-else-if="ui.justReconnected"
    class="flex items-center justify-center gap-2 bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white"
    role="status"
  >
    <span>{{ ui.hasPendingWrites ? $t('offline.restored') : $t('offline.synced') }}</span>
  </div>
</template>
