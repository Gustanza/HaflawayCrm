<script setup>
/**
 * Signed in, but the custom claims grant nothing — either an admin has not run
 * syncClaims yet, or the account was deactivated. Without this screen the user would
 * land in the app and meet a wall of permission errors with no explanation.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()
const checking = ref(false)
const lastCheckedAt = ref(null)

const lastCheckedLabel = computed(() =>
  lastCheckedAt.value
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
        lastCheckedAt.value,
      )
    : null,
)

async function checkAgain() {
  checking.value = true
  try {
    const refreshed = await auth.refreshClaims()
    if (!refreshed) {
      ui.error(t(auth.errorKey ?? 'auth.error.network'))
    } else if (auth.canUseApp) {
      router.replace({ name: 'work-queue' })
    } else {
      // The COMMON case: the token refreshed fine, the admin simply has not provisioned
      // the account yet. Falling through both branches meant a new hire tapped the only
      // button on the screen and nothing whatsoever happened.
      lastCheckedAt.value = new Date()
      ui.info(t('auth.noAccess.stillWaiting'))
    }
  } finally {
    // Without this the button stays disabled forever when the request fails, and the only
    // way out is Sign out — which then needs the network to sign back in.
    checking.value = false
  }
}

async function signOut() {
  await auth.signOut()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="card p-6 sm:p-8 text-center">
    <div class="mx-auto size-12 rounded-full bg-amber-100 grid place-items-center" aria-hidden="true">
      <svg class="size-6 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    </div>

    <h1 class="mt-4 text-lg font-semibold text-slate-900">{{ $t('auth.noAccess.title') }}</h1>
    <p class="mt-2 text-sm text-slate-600">
      {{ auth.isSignedIn && auth.isProvisioned && !auth.isActive
          ? $t('auth.noAccess.deactivated')
          : $t('auth.noAccess.body') }}
    </p>

    <div class="mt-6 space-y-2">
      <button type="button" class="btn-primary w-full" :disabled="checking" @click="checkAgain">
        {{ checking ? $t('common.loading') : $t('auth.noAccess.checkAgain') }}
      </button>
      <!-- The way out for a console-created account: if nobody is admin yet, Setup
           offers the one-time claim. If somebody already is, it explains that. -->
      <RouterLink :to="{ name: 'setup' }" class="btn-secondary w-full">
        {{ $t('setup.title') }}
      </RouterLink>
      <button type="button" class="btn-secondary w-full" @click="signOut">
        {{ $t('auth.signOut') }}
      </button>
      <p v-if="lastCheckedLabel" class="text-xs text-slate-500" role="status">
        {{ $t('auth.noAccess.lastChecked', { time: lastCheckedLabel }) }}
      </p>
    </div>
  </div>
</template>
