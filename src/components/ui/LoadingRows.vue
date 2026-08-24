<script setup>
/** Skeleton rows. A list that is loading should look like a list, not like nothing. */
defineProps({ rows: { type: Number, default: 5 } })
</script>

<template>
  <div class="space-y-2" role="status" :aria-label="$t('common.loading')">
    <div v-for="n in rows" :key="n" class="card p-4 animate-pulse">
      <div class="h-4 w-1/3 rounded bg-slate-200" />
      <div class="mt-2 h-3 w-1/2 rounded bg-slate-100" />
    </div>
  </div>
</template>
