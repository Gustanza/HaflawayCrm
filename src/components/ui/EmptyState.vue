<script setup>
/** §16 Definition of Done: every list needs a designed empty state, not a blank area. */
defineProps({
  title: { type: String, required: true },
  body: { type: String, default: '' },
})
</script>

<template>
  <div class="card p-8 text-center">
    <p class="text-sm font-medium text-slate-700">{{ title }}</p>
    <p v-if="body" class="mt-1 text-sm text-slate-500">{{ body }}</p>
    <div class="mt-4"><slot /></div>
  </div>
</template>
