<script setup>
/**
 * Sign-in. Email + password. Self-registration (RegisterView.vue) is the other way in —
 * D7 originally ruled it out on the theory of one shared org (50 strangers sharing one
 * lead pool), which no longer applies now that registering mints your OWN isolated org.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()

// A stale error from another auth screen must not greet the user here.
onMounted(() => auth.clearError())

// Only a credentials failure means the FIELDS are wrong. A network failure does not.
const isCredentialError = computed(() =>
  ['auth.error.invalidCredentials', 'auth.error.invalidEmail'].includes(auth.errorKey),
)
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const showPassword = ref(false)

async function submit() {
  auth.clearError()
  if (!email.value.trim() || !password.value) return

  const ok = await auth.signIn(email.value, password.value)
  if (!ok) {
    password.value = ''
    return
  }
  // Claims arrive with the token; the guard decides where they may actually go.
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
  router.replace(redirect ?? { name: 'work-queue' })
}
</script>

<template>
  <div class="card p-6 sm:p-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-900">{{ $t('app.name') }}</h1>
      <p class="mt-1 text-sm text-slate-500">{{ $t('auth.welcome') }}</p>
    </header>

    <form class="space-y-4" novalidate @submit.prevent="submit">
      <div>
        <label for="email" class="field-label">{{ $t('auth.email') }}</label>
        <input
          id="email"
          v-model="email"
          type="email"
          class="field-input"
          autocomplete="username"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          required
          :placeholder="$t('auth.emailPlaceholder')"
          :aria-invalid="isCredentialError"
          :aria-describedby="auth.errorKey ? 'login-error' : undefined"
        />
      </div>

      <div>
        <label for="password" class="field-label">{{ $t('auth.password') }}</label>
        <div class="relative">
          <input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="field-input pr-20"
            autocomplete="current-password"
            required
            :aria-invalid="isCredentialError"
            :aria-describedby="auth.errorKey ? 'login-error' : undefined"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 px-3 grid place-items-center text-slate-500
                   hover:text-slate-700"
            :aria-label="showPassword ? $t('auth.hidePassword') : $t('auth.showPassword')"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-if="!showPassword" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
              <circle v-if="!showPassword" cx="12" cy="12" r="3" />
              <path v-else d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 3.6-.7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- role="alert" so a screen reader announces the failure without a focus jump. -->
      <p v-if="auth.errorKey" id="login-error" class="field-error" role="alert">
        {{ $t(auth.errorKey) }}
      </p>

      <button type="submit" class="btn-primary w-full" :disabled="auth.busy">
        {{ auth.busy ? $t('auth.signingIn') : $t('auth.signIn') }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm">
      <RouterLink :to="{ name: 'forgot-password' }" class="text-brand-700 hover:underline">
        {{ $t('auth.forgotPassword') }}
      </RouterLink>
    </p>
    <p class="mt-2 text-center text-sm">
      <RouterLink :to="{ name: 'register' }" class="text-brand-700 hover:underline">
        {{ $t('auth.register.title') }}
      </RouterLink>
    </p>
  </div>
</template>
