<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

// The moment access arrives — the background claims refresh, or "Check again" — move on.
// Nobody should have to find their own way out of this screen once they are let in.
watch(
  () => auth.canUseApp,
  (ok) => {
    if (ok) router.replace({ name: 'work-queue' })
  },
  { immediate: true },
)

// Access is granted by a server-side trigger moments after registration or an admin's
// change. Check quietly for a couple of minutes so the user is not left pressing a button.
let polls = 0
const poll = setInterval(() => {
  if (auth.canUseApp || ++polls > 24) return clearInterval(poll)
  auth.refreshClaims()
}, 5000)
onUnmounted(() => clearInterval(poll))

const checking = ref(false)
const lastChecked = ref(null)

const isDeactivated = computed(
  () => auth.isSignedIn && auth.isProvisioned && !auth.isActive,
)

async function checkAgain() {
  checking.value = true
  await auth.refreshClaims()
  lastChecked.value = new Date()
  checking.value = false
}

async function onSignOut() {
  await auth.signOut()
}
</script>

<template>
  <div class="text-center">
    <h1 class="text-xl font-semibold text-slate-900">
      {{ isDeactivated ? t('auth.noAccess.deactivated') : t('auth.noAccess.title') }}
    </h1>
    <p class="mt-2 text-sm text-slate-600">{{ t('auth.noAccess.body') }}</p>

    <button type="button" class="btn-primary mt-6 w-full" :disabled="checking" @click="checkAgain">
      {{ checking ? t('common.loading') : t('auth.noAccess.checkAgain') }}
    </button>

    <p v-if="lastChecked" class="mt-3 text-xs text-slate-500">
      {{ t('auth.noAccess.lastChecked', { time: lastChecked.toLocaleTimeString() }) }}
    </p>
    <p v-if="lastChecked && !auth.canUseApp" class="mt-1 text-sm text-amber-700">
      {{ t('auth.noAccess.stillWaiting') }}
    </p>

    <p class="mt-6 text-sm">
      <RouterLink :to="{ name: 'setup' }" class="text-brand-700 hover:underline">
        {{ t('auth.noAccess.setupLink') }}
      </RouterLink>
    </p>

    <button type="button" class="btn-ghost mt-4 text-sm" @click="onSignOut">
      {{ t('auth.signOut') }}
    </button>
  </div>
</template>
