<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { setLocale } from '@/i18n.js'

const auth = useAuthStore()
const ui = useUiStore()

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
  <!-- The first paint happens before Firebase has resolved the session. Showing app
       content here and then yanking it away would be worse than a brief hold. -->
  <div v-if="auth.initialising" class="min-h-dvh grid place-items-center bg-slate-50">
    <div class="flex flex-col items-center gap-3">
      <div
        class="size-8 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin"
        aria-hidden="true"
      />
      <p class="text-sm text-slate-500">{{ $t('common.loading') }}</p>
    </div>
  </div>

  <RouterView v-else />
</template>
