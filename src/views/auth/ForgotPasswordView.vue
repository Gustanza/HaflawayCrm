<script setup>
import { nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { useAuthStore } from '@/stores/auth.js'

const auth = useAuthStore()

// Without this, a failed login's "email or password is incorrect" follows the user here
// and is announced by role="alert" above an empty email field.
onMounted(() => auth.clearError())
const email = ref('')
const sent = ref(false)
const confirmation = useTemplateRef('confirmation')

async function submit() {
  if (!email.value.trim()) return
  // resetPassword() reports success even for an unknown address, so this screen cannot
  // be used to discover which emails belong to Haflaway staff.
  if (await auth.resetPassword(email.value)) {
    sent.value = true
    await nextTick()
    confirmation.value?.focus()
  }
}
</script>

<template>
  <div class="card p-6 sm:p-8">
    <h1 class="text-xl font-semibold text-slate-900">{{ $t('auth.forgotPasswordTitle') }}</h1>

    <template v-if="!sent">
      <p class="mt-1 mb-6 text-sm text-slate-500">{{ $t('auth.forgotPasswordHelp') }}</p>
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <div>
          <label for="reset-email" class="field-label">{{ $t('auth.email') }}</label>
          <input id="reset-email" v-model="email" type="email" class="field-input"
                 autocomplete="username" inputmode="email" autocapitalize="none" required
                 :placeholder="$t('auth.emailPlaceholder')" />
        </div>
        <p v-if="auth.errorKey" class="field-error" role="alert">{{ $t(auth.errorKey) }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="auth.busy">
          {{ auth.busy ? $t('auth.sending') : $t('auth.sendResetLink') }}
        </button>
      </form>
    </template>

    <!-- The live region is always mounted: inserting it and its text in the same tick is
         announced by almost no screen reader. Focus moves here too, because the v-else
         swaps out the submit button that had it. -->
    <p
      ref="confirmation"
      class="mt-4 text-sm text-slate-700 empty:hidden focus:outline-none"
      role="status"
      tabindex="-1"
    >
      {{ sent ? $t('auth.resetLinkSent') : '' }}
    </p>

    <p class="mt-6 text-center text-sm">
      <RouterLink :to="{ name: 'login' }" class="text-brand-700 hover:underline">
        {{ $t('auth.backToSignIn') }}
      </RouterLink>
    </p>
  </div>
</template>
