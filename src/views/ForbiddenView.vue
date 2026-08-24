<script setup></script>
<template>
  <div class="p-6 max-w-md mx-auto text-center">
    <h1 class="mt-8 text-lg font-semibold text-slate-900">{{ $t('errors.forbidden') }}</h1>
    <p class="mt-2 text-sm text-slate-600">{{ $t('errors.forbiddenBody') }}</p>
    <RouterLink :to="{ name: 'work-queue' }" class="btn-primary mt-6">
      {{ $t('errors.goHome') }}
    </RouterLink>
  </div>
</template>
