<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
    <h1 class="text-xl font-semibold text-slate-900">{{ t('errors.notFound') }}</h1>
    <p class="max-w-sm text-sm text-slate-600">{{ t('errors.notFoundBody') }}</p>
    <RouterLink :to="{ name: 'work-queue' }" class="btn-primary mt-2">
      {{ t('errors.goHome') }}
    </RouterLink>
  </div>
</template>
