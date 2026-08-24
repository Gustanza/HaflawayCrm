<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { setLocale } from '@/i18n.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import AuthLayout from '@/components/layout/AuthLayout.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import OfflineBanner from '@/components/ui/OfflineBanner.vue'

const auth = useAuthStore()
const ui = useUiStore()

const layout = computed(() => (auth.canUseApp ? AppLayout : AuthLayout))

let unbindConnectivity = () => {}

onMounted(() => {
  unbindConnectivity = ui.bindConnectivity()
})

onUnmounted(() => unbindConnectivity())

// Follow the locale stored on the user's profile, so an agent who prefers Swahili gets
// Swahili on every device they sign in from.
//
// Only when there IS one. Before sign-in — and for a profile that has never set one —
// i18n keeps whatever the user chose on the login screen, which it loaded from
// localStorage. Watching an unconditional 'sw' fallback here overwrote that choice on
// every boot and made the language toggle useless.
watch(
  () => auth.locale,
  (locale) => {
    if (locale) setLocale(locale)
  },
  { immediate: true },
)
</script>

<template>
  <!-- The first paint happens before Firebase has resolved the session. Showing the
       login form here and then yanking it away would be worse than a brief hold. -->
  <div v-if="auth.initialising" class="min-h-dvh grid place-items-center bg-slate-50">
    <div class="flex flex-col items-center gap-3">
      <div
        class="size-8 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin"
        aria-hidden="true"
      />
      <p class="text-sm text-slate-500">{{ $t('common.loading') }}</p>
    </div>
  </div>

  <template v-else>
    <!-- AppLayout renders its own banner above its sticky header; rendering one here too
         would put two elements at viewport top fighting over z-index. -->
    <OfflineBanner v-if="!auth.canUseApp" />
    <component :is="layout">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </component>
    <ToastHost />
  </template>
</template>
