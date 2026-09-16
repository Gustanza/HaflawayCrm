<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()
const { t } = useI18n()

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
