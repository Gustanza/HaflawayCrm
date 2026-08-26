<script setup>
/**
 * Self-service registration: an email + password account, plus a brand-new organisation
 * that this person becomes the admin of. See src/services/provisioning.service.js
 * registerOrganization() for the two-step write this drives.
 *
 * RECOVERY CASE: the Auth account can be created successfully and the organisation step can
 * still fail (a dropped connection, or a genuinely exhausted slug search). Retrying this
 * form then fails with "email already in use" — the account exists, it just has no org yet.
 * Rather than dead-ending on that error, we recognise it and send the (already signed-in)
 * caller to /setup, which now offers the exact same "create your organisation" step as its
 * resumption path.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { registerOrganization } from '@/services/provisioning.service.js'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const companyName = ref('')
const displayName = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)

const emailValid = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))
const canSubmit = computed(
  () =>
    !submitting.value &&
    companyName.value.trim().length > 0 &&
    emailValid.value &&
    password.value.length >= 8,
)

async function submit() {
  auth.clearError()
  if (!canSubmit.value) return
  submitting.value = true

  try {
    const created = await auth.registerAccount(email.value, password.value)
    if (!created) {
      if (auth.errorKey === 'auth.error.emailInUse') {
        // The account exists already — most likely from a previous attempt whose org step
        // failed. They may already be signed in as it; either way /setup is the way forward.
        router.replace({ name: 'setup' })
        return
      }
      return
    }

    await registerOrganization({
      user: { uid: auth.uid, email: email.value.trim().toLowerCase() },
      companyName: companyName.value,
      displayName: displayName.value,
    })

    ui.success(t('auth.register.done'))
    await auth.refreshClaims()
    router.replace({ name: 'work-queue' })
  } catch {
    // The Auth account exists but the org step failed. Same recovery as above: /setup can
    // pick this back up because the caller is already signed in.
    ui.error(t('auth.register.orgStepFailed'))
    router.replace({ name: 'setup' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="card p-6 sm:p-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-900">{{ $t('auth.register.title') }}</h1>
      <p class="mt-1 text-sm text-slate-500">{{ $t('auth.register.subtitle') }}</p>
    </header>

    <form class="space-y-4" novalidate @submit.prevent="submit">
      <div>
        <label for="r-company" class="field-label">{{ $t('auth.register.companyName') }}</label>
        <input
          id="r-company"
          v-model="companyName"
          type="text"
          class="field-input"
          autocomplete="organization"
          required
          :placeholder="$t('auth.register.companyNamePlaceholder')"
        />
      </div>

      <div>
        <label for="r-name" class="field-label">{{ $t('settings.displayName') }}</label>
        <input
          id="r-name"
          v-model="displayName"
          type="text"
          class="field-input"
          autocomplete="name"
        />
      </div>

      <div>
        <label for="r-email" class="field-label">{{ $t('auth.email') }}</label>
        <input
          id="r-email"
          v-model="email"
          type="email"
          class="field-input"
          autocomplete="username"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          required
          :placeholder="$t('auth.emailPlaceholder')"
        />
      </div>

      <div>
        <label for="r-password" class="field-label">{{ $t('auth.password') }}</label>
        <div class="relative">
          <input
            id="r-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="field-input pr-20"
            autocomplete="new-password"
            required
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
        <p class="mt-1.5 text-xs text-slate-500">{{ $t('settings.passwordTooShort') }}</p>
      </div>

      <p v-if="auth.errorKey" class="field-error" role="alert">{{ $t(auth.errorKey) }}</p>

      <button type="submit" class="btn-primary w-full" :disabled="!canSubmit">
        {{ submitting ? $t('common.loading') : $t('auth.register.action') }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm">
      <RouterLink :to="{ name: 'login' }" class="text-brand-700 hover:underline">
        {{ $t('auth.backToSignIn') }}
      </RouterLink>
    </p>
  </div>
</template>
