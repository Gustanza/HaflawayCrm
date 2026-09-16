<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()
const { t } = useI18n()

const email = ref('')
const sent = ref(false)

async function onSubmit() {
  auth.clearError()
  const ok = await auth.resetPassword(email.value)
  if (ok) sent.value = true
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-slate-900">{{ t('auth.forgotPasswordTitle') }}</h1>

    <div v-if="sent" class="mt-4">
      <p class="text-sm text-slate-700">{{ t('auth.resetLinkSent') }}</p>
      <RouterLink :to="{ name: 'login' }" class="btn-secondary mt-5 w-full">
        {{ t('auth.backToSignIn') }}
      </RouterLink>
    </div>

    <template v-else>
      <p class="mt-1 text-sm text-slate-600">{{ t('auth.forgotPasswordHelp') }}</p>

      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label for="forgot-email" class="field-label">{{ t('auth.email') }}</label>
          <input
            id="forgot-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="field-input"
            :placeholder="t('auth.emailPlaceholder')"
          />
        </div>

        <p v-if="auth.errorKey" class="field-error" role="alert">{{ t(auth.errorKey) }}</p>

        <button type="submit" class="btn-primary w-full" :disabled="auth.busy">
          {{ auth.busy ? t('auth.sending') : t('auth.sendResetLink') }}
        </button>
      </form>

      <p class="mt-5 text-center text-sm">
        <RouterLink :to="{ name: 'login' }" class="text-brand-700 hover:underline">
          {{ t('auth.backToSignIn') }}
        </RouterLink>
      </p>
    </template>
  </div>
</template>
