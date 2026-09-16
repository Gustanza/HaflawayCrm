<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { registerOrganization } from '@/services/provisioning.service.js'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const displayName = ref('')
const companyName = ref('')
const showPassword = ref(false)

/** 'account' | 'org' | 'org-failed' */
const step = ref('account')
const orgError = ref(null)

/**
 * `registerAccount()` only returns true/false, not the credential — the auth store's own
 * onAuthStateChanged listener is what populates `auth.uid`, and that fires asynchronously
 * relative to the createUserWithEmailAndPassword promise settling. A short poll is simpler
 * and less invasive than reaching into the store to thread the credential through.
 */
async function waitForUid(maxMs = 5000) {
  const start = Date.now()
  while (!auth.uid && Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return auth.uid
}

async function createOrganisation() {
  orgError.value = null
  const uid = await waitForUid()
  if (!uid) {
    orgError.value = t('auth.error.generic')
    step.value = 'org-failed'
    return
  }
  try {
    await registerOrganization({
      user: { uid, email: email.value.trim() },
      companyName: companyName.value,
      displayName: displayName.value,
    })
    // The custom claim that actually unlocks the app is set by a server-side trigger
    // moments later, not by this write — the no-access screen's "check again" is the
    // designed way to pick that up (see stores/auth.js#refreshClaims).
    router.push({ name: 'no-access' })
  } catch (error) {
    orgError.value = error?.message || t('auth.error.generic')
    step.value = 'org-failed'
  }
}

async function onSubmit() {
  auth.clearError()
  const ok = await auth.registerAccount(email.value, password.value)
  if (!ok) return
  step.value = 'org'
  await createOrganisation()
}

async function retryOrg() {
  step.value = 'org'
  await createOrganisation()
}
</script>

<template>
  <div>
    <template v-if="step === 'account'">
      <h1 class="text-xl font-semibold text-slate-900">{{ t('auth.register.title') }}</h1>
      <p class="mt-1 text-sm text-slate-600">{{ t('auth.register.subtitle') }}</p>

      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <div>
          <label for="reg-company" class="field-label">{{ t('auth.register.companyName') }}</label>
          <input
            id="reg-company"
            v-model="companyName"
            type="text"
            required
            class="field-input"
            :placeholder="t('auth.register.companyNamePlaceholder')"
          />
        </div>

        <div>
          <label for="reg-name" class="field-label">{{ t('auth.register.displayName') }}</label>
          <input
            id="reg-name"
            v-model="displayName"
            type="text"
            required
            class="field-input"
            :placeholder="t('auth.register.displayNamePlaceholder')"
          />
        </div>

        <div>
          <label for="reg-email" class="field-label">{{ t('auth.email') }}</label>
          <input
            id="reg-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="field-input"
            :placeholder="t('auth.emailPlaceholder')"
          />
        </div>

        <div>
          <label for="reg-password" class="field-label">{{ t('auth.password') }}</label>
          <div class="relative">
            <input
              id="reg-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              required
              minlength="8"
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
          {{ auth.busy ? t('auth.sending') : t('auth.register.action') }}
        </button>
      </form>

      <p class="mt-5 text-center text-sm text-slate-600">
        {{ t('auth.haveAccountAlready') }}
        <RouterLink :to="{ name: 'login' }" class="font-medium text-brand-700 hover:underline">
          {{ t('auth.signIn') }}
        </RouterLink>
      </p>
    </template>

    <template v-else-if="step === 'org'">
      <div class="flex flex-col items-center gap-3 py-6 text-center">
        <div
          class="size-8 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin"
          aria-hidden="true"
        />
        <p class="text-sm text-slate-600">{{ t('common.loading') }}</p>
      </div>
    </template>

    <template v-else>
      <h1 class="text-xl font-semibold text-slate-900">{{ t('auth.register.orgStepFailed') }}</h1>
      <p v-if="orgError" class="field-error mt-2">{{ orgError }}</p>
      <button type="button" class="btn-primary mt-6 w-full" @click="retryOrg">
        {{ t('auth.register.retryOrg') }}
      </button>
    </template>
  </div>
</template>
