<script setup>
/** Centred single-column shell for signed-out screens. */
import LocaleToggle from '@/components/ui/LocaleToggle.vue'
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-slate-50">
    <main class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <slot />
      </div>
    </main>

    <!-- The language switch has to live here: before sign-in there is no profile document
         to read a locale from, so without it the login screen is permanently Swahili. -->
    <footer class="p-4 flex flex-col items-center gap-3">
      <LocaleToggle />
      <p class="text-xs text-slate-500">{{ $t('app.name') }}</p>
    </footer>
  </div>
</template>
