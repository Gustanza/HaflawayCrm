<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const showPassword = ref(false)

async function onSubmit() {
  auth.clearError()
  const ok = await auth.signIn(email.value, password.value)
  if (!ok) return
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
  router.push(redirect || { name: 'work-queue' })
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-slate-900">{{ t('auth.welcome') }}</h1>

    <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
      <div>
        <label for="login-email" class="field-label">{{ t('auth.email') }}</label>
        <input
          id="login-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="field-input"
          :placeholder="t('auth.emailPlaceholder')"
        />
      </div>

      <div>
        <label for="login-password" class="field-label">{{ t('auth.password') }}</label>
        <div class="relative">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
            class="field-input pr-16"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-2 text-sm font-medium text-brand-700"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? t('auth.hidePassword') : t('auth.showPassword') }}
          </button>
        </div>
      </div>

      <p v-if="auth.errorKey" class="field-error" role="alert">{{ t(auth.errorKey) }}</p>

      <button type="submit" class="btn-primary w-full" :disabled="auth.busy">
        {{ auth.busy ? t('auth.signingIn') : t('auth.signIn') }}
      </button>
    </form>

    <div class="mt-5 flex flex-col items-center gap-2 text-sm">
      <RouterLink :to="{ name: 'forgot-password' }" class="text-brand-700 hover:underline">
        {{ t('auth.forgotPassword') }}
      </RouterLink>
      <p class="text-slate-600">
        {{ t('auth.noAccountYet') }}
        <RouterLink :to="{ name: 'register' }" class="font-medium text-brand-700 hover:underline">
          {{ t('auth.register.action') }}
        </RouterLink>
      </p>
    </div>
  </div>
</template>
