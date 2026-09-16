<template>
  <div class="min-h-dvh grid place-items-center bg-slate-50 px-4 py-8">
    <div class="w-full max-w-sm">
      <div class="mb-6">
        <span class="text-lg font-semibold text-brand-700">{{ $t('app.name') }}</span>
      </div>
      <main class="card p-6 shadow-sm">
        <slot />
      </main>
    </div>
  </div>
</template>
