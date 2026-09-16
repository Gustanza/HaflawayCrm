<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import LocaleToggle from '@/components/ui/LocaleToggle.vue'
import OfflineBanner from '@/components/ui/OfflineBanner.vue'

const auth = useAuthStore()
const route = useRoute()

const navItems = computed(() => {
  const items = [
    { name: 'work-queue', label: 'nav.workQueue', short: 'nav.short.workQueue' },
    { name: 'leads', label: 'nav.leads', short: 'nav.short.leads' },
    { name: 'dashboard', label: 'nav.dashboard', short: 'nav.short.dashboard' },
  ]
  if (auth.can.manageUsers) {
    items.push({ name: 'admin-users', label: 'nav.users', short: 'nav.short.users' })
  }
  items.push({ name: 'settings', label: 'nav.settings', short: 'nav.short.settings' })
  return items
})

function isActive(name) {
  return route.name === name
}

async function onSignOut() {
  await auth.signOut()
}
</script>

<template>
  <div class="min-h-dvh flex flex-col sm:flex-row">
    <!-- Desktop sidebar — sticky, only its own nav scrolls (min-h-0 is load-bearing here). -->
    <aside class="hidden sm:flex sm:w-56 sm:flex-col sm:sticky sm:top-0 sm:h-dvh sm:shrink-0 sm:border-r sm:border-slate-200 sm:bg-white">
      <div class="flex items-center justify-between px-4 py-4">
        <span class="text-base font-semibold text-brand-700">{{ $t('app.name') }}</span>
      </div>
      <nav class="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center rounded-lg px-3 text-sm font-medium transition-colors"
          style="min-height: var(--spacing-touch)"
          :class="isActive(item.name)
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-700 hover:bg-slate-100'"
        >
          {{ $t(item.label) }}
        </RouterLink>
      </nav>
      <div class="border-t border-slate-200 p-3">
        <p class="truncate px-1 text-sm font-medium text-slate-700">{{ auth.displayName }}</p>
        <div class="mt-2 flex items-center justify-between">
          <LocaleToggle />
          <button type="button" class="btn-ghost text-sm" @click="onSignOut">
            {{ $t('auth.signOut') }}
          </button>
        </div>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <OfflineBanner />

      <!-- Mobile header -->
      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
        <span class="text-base font-semibold text-brand-700">{{ $t('app.name') }}</span>
        <div class="flex items-center gap-1">
          <LocaleToggle />
          <button type="button" class="btn-ghost text-sm" @click="onSignOut">
            {{ $t('auth.signOut') }}
          </button>
        </div>
      </header>

      <main class="flex-1 pb-20 sm:pb-0">
        <slot />
      </main>

      <!-- Mobile bottom tab bar -->
      <nav
        class="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white sm:hidden"
        style="padding-bottom: env(safe-area-inset-bottom)"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium"
          :class="isActive(item.name) ? 'text-brand-700' : 'text-slate-500'"
        >
          {{ $t(item.short) }}
        </RouterLink>
      </nav>
    </div>
  </div>
</template>
