<script setup>
/**
 * The signed-in shell.
 *
 * TODO.md P7: the deployment device is a phone. Mobile gets a bottom tab bar — thumb
 * reach matters more than screen real estate — plus a "More" drawer holding everything
 * that does not fit. Desktop gets a persistent sidebar.
 *
 * The drawer is not optional. Without it, a manager cannot reach Pipeline or Analytics,
 * finance cannot reach Expenses, an admin cannot reach Users, and NOBODY can reach
 * Settings — which is the only place to switch language (§13). Half the product would
 * ship desktop-only by accident.
 *
 * The nav is filtered by role, so an agent never sees a Money tab they cannot open (§7.1).
 */
import { computed, watch, nextTick, onBeforeUnmount, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import OfflineBanner from '@/components/ui/OfflineBanner.vue'
import LocaleToggle from '@/components/ui/LocaleToggle.vue'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const ALL_NAV = [
  { name: 'work-queue', labelKey: 'nav.workQueue', shortKey: 'nav.short.workQueue', icon: 'inbox', primary: true },
  { name: 'leads', labelKey: 'nav.leads', shortKey: 'nav.short.leads', icon: 'users', primary: true },
  { name: 'urgency', labelKey: 'nav.urgency', shortKey: 'nav.short.urgency', icon: 'clock', primary: true },
  { name: 'pipeline', labelKey: 'nav.pipeline', icon: 'columns', roles: ['admin', 'manager', 'finance', 'viewer'] },
  { name: 'analytics', labelKey: 'nav.analytics', icon: 'chart', roles: ['admin', 'manager', 'finance', 'viewer'] },
  { name: 'campaigns', labelKey: 'nav.campaigns', icon: 'megaphone', roles: ['admin', 'manager', 'finance'] },
  { name: 'expenses', labelKey: 'nav.expenses', icon: 'receipt', roles: ['admin', 'finance'] },
  { name: 'admin-users', labelKey: 'nav.users', icon: 'shield', roles: ['admin'] },
  { name: 'setup', labelKey: 'setup.title', icon: 'cog', roles: ['admin'] },
  { name: 'settings', labelKey: 'nav.settings', icon: 'cog', alwaysInDrawer: true },
]

const nav = computed(() => ALL_NAV.filter((item) => !item.roles || item.roles.includes(auth.role)))

// Three destination tabs + quick-add + "More" = five slots, 72px each at 360px. That is
// the ceiling; a sixth is where thumbs start mis-tapping.
const mobileNav = computed(() => nav.value.filter((i) => i.primary).slice(0, 3))
const drawerNav = computed(() => nav.value.filter((i) => !i.primary))

const isCurrent = (name) => route.name === name

const drawerPanel = useTemplateRef('drawerPanel')

// Close the drawer on navigation, or it stays open over the page the user just chose.
watch(() => route.fullPath, () => ui.toggleSidebar(false))

/**
 * Modal behaviour for the drawer.
 *
 * It declares `role="dialog" aria-modal="true"`, which tells a screen reader the rest of
 * the page is inert. That has to be true, so: focus moves in, Tab cycles inside, focus
 * returns to whatever opened it, and the body stops scrolling underneath. Without the
 * scroll lock the page lurches behind the menu on Android and the agent loses their place
 * in the lead list.
 */
let lastFocused = null

function focusableInDrawer() {
  return [
    ...(drawerPanel.value?.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ]
}

function onDrawerKeydown(event) {
  if (event.key === 'Escape') {
    ui.toggleSidebar(false)
    return
  }
  if (event.key !== 'Tab') return

  const items = focusableInDrawer()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function lockScroll(locked) {
  if (typeof document === 'undefined') return
  document.body.style.overflow = locked ? 'hidden' : ''
}

watch(
  () => ui.sidebarOpen,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement
      lockScroll(true)
      await nextTick()
      // Focus the panel itself, not the first control — `querySelector('a, button')`
      // matched the close button in DOM order, so the first thing a screen-reader user
      // heard on opening the menu was "Funga, kitufe".
      drawerPanel.value?.focus()
    } else {
      lockScroll(false)
      lastFocused?.focus?.()
      lastFocused = null
    }
  },
)

// A route change can unmount this while the drawer is open; do not leave the body locked.
onBeforeUnmount(() => lockScroll(false))

async function handleSignOut() {
  ui.toggleSidebar(false)
  try {
    await auth.signOut()
  } catch {
    // Signing out locally is what matters; a failed network round trip must not strand
    // the user on a screen they were trying to leave.
  }
  router.push({ name: 'login' })
}

const ICONS = {
  inbox: 'M2 13h4l2 3h8l2-3h4M4 5h16l2 8v6H2v-6z',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM22 20v-2a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  columns: 'M4 4h5v16H4zM10 4h5v16h-5zM16 4h4v16h-4z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  more: 'M4 12h16M4 6h16M4 18h16',
}
</script>

<template>
  <div class="min-h-dvh flex flex-col md:flex-row bg-slate-50">
    <!-- Desktop sidebar.
         `sticky top-0 h-dvh` is load-bearing: without a height constraint the aside
         stretches to match the document, so on a long list it scrolls away with the page
         and the user is left with the profile footer floating at the bottom and no nav.
         Pinned to the viewport, its own `nav` handles the overflow instead. -->
    <aside
      class="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col bg-white ring-1 ring-slate-200
             md:sticky md:top-0 md:h-dvh"
    >
      <div class="h-16 shrink-0 flex items-center px-5 border-b border-slate-200">
        <span class="font-semibold text-slate-900">{{ $t('app.name') }}</span>
      </div>

      <nav class="flex-1 min-h-0 p-3 space-y-1 overflow-y-auto" :aria-label="$t('nav.menu')">
        <RouterLink
          v-for="item in nav"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors"
          :class="
            isCurrent(item.name)
              ? 'bg-brand-50 text-brand-700'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          "
          :aria-current="isCurrent(item.name) ? 'page' : undefined"
        >
          <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="ICONS[item.icon]" />
          </svg>
          {{ $t(item.labelKey) }}
        </RouterLink>
      </nav>

      <div class="shrink-0 border-t border-slate-200 p-3">
        <div class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600">
          <span
            class="size-8 shrink-0 rounded-full bg-brand-100 text-brand-700 grid place-items-center
                   text-xs font-semibold"
            aria-hidden="true"
          >
            {{ auth.displayName.slice(0, 2).toUpperCase() }}
          </span>
          <span class="truncate">
            <span class="block font-medium text-slate-900 truncate">{{ auth.displayName }}</span>
            <span class="block text-xs text-slate-500">{{ auth.role }}</span>
          </span>
        </div>
        <div class="mt-2 px-3">
          <LocaleToggle />
        </div>
        <button type="button" class="btn-ghost w-full mt-1 text-sm justify-start"
                @click="handleSignOut">
          {{ $t('auth.signOut') }}
        </button>
      </div>
    </aside>

    <div class="flex-1 min-w-0 flex flex-col">
      <!-- The banner lives INSIDE the layout, above the header, so the two cannot both
           pin to viewport top and fight over z-index. -->
      <OfflineBanner />

      <!-- Mobile top bar -->
      <header class="md:hidden sticky top-0 z-20 h-14 flex items-center justify-between px-4
                     bg-white ring-1 ring-slate-200">
        <span class="font-semibold text-slate-900">{{ $t('app.name') }}</span>
        <span class="text-sm text-slate-500 truncate max-w-[50%]">{{ auth.displayName }}</span>
      </header>

      <!-- Content. Bottom padding clears the mobile tab bar. -->
      <main class="flex-1 min-w-0 pb-28 md:pb-0">
        <slot />
      </main>
    </div>

    <!-- Mobile drawer: everything the bottom bar cannot hold -->
    <Transition name="drawer">
      <div v-if="ui.sidebarOpen" class="md:hidden fixed inset-0 z-40 flex">
        <div
          class="absolute inset-0 bg-slate-900/40"
          aria-hidden="true"
          @click="ui.toggleSidebar(false)"
        />
        <div
          ref="drawerPanel"
          class="relative ml-auto w-72 max-w-[85%] bg-white h-full flex flex-col shadow-xl
                 focus:outline-none"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          :aria-label="$t('nav.menu')"
          @keydown="onDrawerKeydown"
        >
          <div class="h-14 flex items-center justify-between px-4 border-b border-slate-200">
            <span class="font-semibold text-slate-900">{{ $t('nav.menu') }}</span>
            <button
              type="button"
              class="btn-ghost px-3"
              :aria-label="$t('common.close')"
              @click="ui.toggleSidebar(false)"
            >
              <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav class="flex-1 min-h-0 p-3 space-y-1 overflow-y-auto">
            <RouterLink
              v-for="item in drawerNav"
              :key="item.name"
              :to="{ name: item.name }"
              class="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
              :class="
                isCurrent(item.name) ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
              "
              :aria-current="isCurrent(item.name) ? 'page' : undefined"
            >
              <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path :d="ICONS[item.icon]" />
              </svg>
              {{ $t(item.labelKey) }}
            </RouterLink>
          </nav>

          <div class="border-t border-slate-200 p-3 space-y-3"
               style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))">
            <div class="px-3 flex items-center justify-between gap-2">
              <span class="text-xs text-slate-500">{{ auth.role }}</span>
              <!-- §13 requires the locale to be switchable once signed in. Before this,
                   LocaleToggle was mounted only in AuthLayout — which renders only when
                   the user is NOT signed in — so its write-through branch was dead code
                   and a signed-in English speaker had no control anywhere. -->
              <LocaleToggle />
            </div>
            <button type="button" class="btn-secondary w-full" @click="handleSignOut">
              {{ $t('auth.signOut') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Mobile bottom tabs. Thumb-reachable. -->
    <nav
      class="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200
             flex items-stretch"
      style="padding-bottom: env(safe-area-inset-bottom)"
      :aria-label="$t('nav.menu')"
    >
      <RouterLink
        v-for="item in mobileNav"
        :key="item.name"
        :to="{ name: item.name }"
        class="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-xs
               font-medium"
        :class="isCurrent(item.name) ? 'text-brand-700' : 'text-slate-500'"
        :aria-current="isCurrent(item.name) ? 'page' : undefined"
      >
        <svg class="size-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="ICONS[item.icon]" />
        </svg>
        <span class="truncate max-w-full px-0.5">{{ $t(item.shortKey ?? item.labelKey) }}</span>
      </RouterLink>

      <!-- Quick-add is the highest-frequency action in the product (P7): always one tap. -->
      <RouterLink
        v-if="auth.can.createLead"
        :to="{ name: 'lead-new' }"
        class="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-xs
               font-semibold text-brand-700"
      >
        <span class="size-6 rounded-full bg-brand-600 text-white grid place-items-center text-lg
                     leading-none shrink-0" aria-hidden="true">+</span>
        <span class="truncate max-w-full px-0.5">{{ $t('nav.short.newLead') }}</span>
      </RouterLink>

      <button
        type="button"
        class="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-xs
               font-medium text-slate-500"
        :aria-expanded="ui.sidebarOpen"
        @click="ui.toggleSidebar(true)"
      >
        <svg class="size-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path :d="ICONS.more" />
        </svg>
        <span class="truncate max-w-full px-0.5">{{ $t('nav.more') }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.15s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
</style>
