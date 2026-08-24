<script setup>
/**
 * Honest placeholder for a route whose screen is not built yet.
 *
 * Deliberately says which phase of TODO.md owns it, so nobody — user or agent — mistakes
 * an unbuilt screen for a broken one.
 */
defineProps({
  title: { type: String, required: true },
  phase: { type: String, required: true },
  note: { type: String, default: '' },
})

const isDev = import.meta.env.DEV
</script>

<template>
  <div class="p-4 sm:p-6">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-900">{{ title }}</h1>
    </header>
    <div class="card p-6 border-dashed">
      <p class="text-sm font-medium text-slate-700">{{ $t('phase.comingSoon') }}</p>
      <p class="mt-1 text-sm text-slate-500">{{ $t('phase.plannedIn', { phase }) }}</p>
      <!-- The build note is for developers, not for a Swahili-first field agent: it is
           English, cites TODO.md section numbers and source paths, and would be untranslated
           text on a user's screen. Dev builds only. -->
      <p v-if="note && isDev" class="mt-3 text-xs text-slate-400 font-mono">{{ note }}</p>
    </div>
  </div>
</template>
