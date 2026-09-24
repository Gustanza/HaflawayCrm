<script setup>
defineProps({
  name: { type: String, required: true },
})
</script>

<template>
  <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g v-if="name === 'work-queue'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 7h11M8 12h11M8 17h11" />
      <path d="M5 7.5 4 8.5l1.2 1.2M5 12.5 4 13.5l1.2 1.2" />
    </g>
    <g v-else-if="name === 'leads'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M4 18c.6-2.8 2.5-4.2 5-4.2S17.4 15.2 18 18" />
      <circle cx="16.5" cy="8.5" r="2.2" />
      <path d="M16.5 13.2c1.8.2 3.2 1.3 3.8 3.3" />
    </g>
    <g v-else-if="name === 'dashboard'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19V9l5 4 6-8 5 6v8H4Z" />
    </g>
    <g v-else-if="name === 'deals-won'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8.5 12.2 11 14.7 15.8 9.5" />
    </g>
    <g v-else-if="name === 'admin-users'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.2" />
      <path d="M4 19c.5-3 2.4-4.5 5-4.5s4.5 1.5 5 4.5" />
      <path d="M14.5 14.8c1.7.2 3.2 1.2 3.8 3.2" />
    </g>
    <g v-else-if="name === 'settings'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v1.6M12 17.9v1.6M19.5 12h-1.6M6.1 12H4.5M17.3 6.7l-1.1 1.1M7.8 16.2l-1.1 1.1M17.3 17.3l-1.1-1.1M7.8 7.8 6.7 6.7" />
    </g>
  </svg>
</template>
