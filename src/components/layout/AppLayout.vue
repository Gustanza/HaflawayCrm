<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import OfflineBanner from '@/components/ui/OfflineBanner.vue'
import NavIcon from '@/components/layout/NavIcon.vue'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

const auth = useAuthStore()
const route = useRoute()

const navItems = computed(() => {
  const items = [
    { name: 'work-queue', label: 'nav.workQueue', short: 'nav.short.workQueue' },
    { name: 'leads', label: 'nav.leads', short: 'nav.short.leads' },
    { name: 'dashboard', label: 'nav.dashboard', short: 'nav.short.dashboard' },
    { name: 'deals-won', label: 'nav.dealsWon', short: 'nav.short.dealsWon' },
  ]
  if (auth.can.manageUsers) {
    items.push({ name: 'admin-users', label: 'nav.users', short: 'nav.short.users' })
  }
  items.push({ name: 'settings', label: 'nav.settings', short: 'nav.short.settings' })
  return items
})

const userInitials = computed(() => initialsFromName(auth.displayName))
const userTone = computed(() => avatarToneFromSeed(auth.displayName || auth.uid))

function isActive(name) {
  return route.name === name
}

async function onSignOut() {
  await auth.signOut()
}
</script>

<template>
  <div class="min-h-dvh flex flex-col sm:flex-row">
    <aside class="hidden sm:flex sm:w-60 sm:flex-col sm:sticky sm:top-0 sm:h-dvh sm:shrink-0 sm:border-r sm:border-slate-200 sm:bg-white">
      <div class="px-4 py-5">
        <span class="text-base font-semibold tracking-tight text-brand-700">{{ $t('app.name') }}</span>
      </div>
      <nav class="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors"
          style="min-height: var(--spacing-touch)"
          :class="isActive(item.name)
            ? 'bg-brand-50 text-brand-800'
            : 'text-slate-700 hover:bg-slate-100'"
        >
          <NavIcon :name="item.name" />
          {{ $t(item.label) }}
        </RouterLink>
      </nav>
      <div class="border-t border-slate-200 p-3">
        <div class="flex items-center gap-3 px-1">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            :class="userTone"
            aria-hidden="true"
          >
            {{ userInitials }}
          </div>
          <p class="min-w-0 truncate text-sm font-medium text-slate-800">{{ auth.displayName }}</p>
        </div>
        <div class="mt-2 flex items-center justify-end">
          <button type="button" class="btn-ghost text-sm" @click="onSignOut">
            {{ $t('auth.signOut') }}
          </button>
        </div>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <OfflineBanner />

      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
        <span class="text-base font-semibold text-brand-700">{{ $t('app.name') }}</span>
        <button type="button" class="btn-ghost text-sm" @click="onSignOut">
          {{ $t('auth.signOut') }}
        </button>
      </header>

      <main class="flex-1 pb-20 sm:pb-0">
        <slot />
      </main>

      <nav
        class="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white sm:hidden"
        style="padding-bottom: env(safe-area-inset-bottom)"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-medium"
          :class="isActive(item.name) ? 'text-brand-800' : 'text-slate-600'"
        >
          <NavIcon :name="item.name" />
          <span class="truncate">{{ $t(item.short) }}</span>
        </RouterLink>
      </nav>
    </div>
  </div>
</template>
