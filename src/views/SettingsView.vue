<script setup>
/**
 * Settings — profile, language, password.
 *
 * Deliberately small. §13 needs a language switch that persists to the profile so it
 * follows the user to another device; everything else here is table stakes.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import LocaleToggle from '@/components/ui/LocaleToggle.vue'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const displayName = ref(auth.profile?.displayName ?? '')
const savingProfile = ref(false)

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)

const passwordMismatch = computed(
  () => confirmPassword.value.length > 0 && newPassword.value !== confirmPassword.value,
)
const passwordTooShort = computed(
  () => newPassword.value.length > 0 && newPassword.value.length < 8,
)
const canChangePassword = computed(
  () =>
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 8 &&
    newPassword.value === confirmPassword.value &&
    !savingPassword.value,
)

async function saveProfile() {
  if (!displayName.value.trim() || savingProfile.value) return
  savingProfile.value = true
  try {
    const db = await getDb()
    await updateDoc(doc(db, 'users', auth.uid), {
      displayName: displayName.value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.uid,
    })
    ui.success(t('settings.profileSaved'))
  } catch {
    ui.error(t('errors.write.generic'))
  } finally {
    savingProfile.value = false
  }
}

async function changePassword() {
  if (!canChangePassword.value) return
  savingPassword.value = true
  const ok = await auth.changePassword(currentPassword.value, newPassword.value)
  savingPassword.value = false

  if (ok) {
    ui.success(t('settings.passwordChanged'))
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } else {
    ui.error(t(auth.errorKey ?? 'auth.error.generic'))
  }
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-md mx-auto space-y-5">
    <h1 class="text-xl font-semibold text-slate-900">{{ $t('nav.settings') }}</h1>

    <section class="card p-4">
      <h2 class="font-medium text-slate-900 mb-3">{{ $t('settings.profile') }}</h2>

      <div class="mb-3">
        <label for="s-name" class="field-label">{{ $t('settings.displayName') }}</label>
        <input id="s-name" v-model="displayName" type="text" class="field-input" autocomplete="name" />
      </div>

      <dl class="mb-4 space-y-1 text-sm">
        <div class="flex justify-between">
          <dt class="text-slate-500">{{ $t('auth.email') }}</dt>
          <dd class="text-slate-900">{{ auth.user?.email }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-slate-500">{{ $t('settings.role') }}</dt>
          <dd class="text-slate-900">{{ auth.role }}</dd>
        </div>
      </dl>

      <button type="button" class="btn-primary w-full" :disabled="savingProfile" @click="saveProfile">
        {{ savingProfile ? $t('common.loading') : $t('common.save') }}
      </button>
    </section>

    <section class="card p-4">
      <h2 class="font-medium text-slate-900 mb-1">{{ $t('common.language') }}</h2>
      <p class="mb-3 text-sm text-slate-500">{{ $t('settings.languageHelp') }}</p>
      <LocaleToggle />
    </section>

    <section class="card p-4">
      <h2 class="font-medium text-slate-900 mb-3">{{ $t('settings.password') }}</h2>

      <form class="space-y-3" novalidate @submit.prevent="changePassword">
        <div>
          <label for="s-current" class="field-label">{{ $t('settings.currentPassword') }}</label>
          <input id="s-current" v-model="currentPassword" type="password" class="field-input"
                 autocomplete="current-password" />
        </div>
        <div>
          <label for="s-new" class="field-label">{{ $t('settings.newPassword') }}</label>
          <input id="s-new" v-model="newPassword" type="password" class="field-input"
                 autocomplete="new-password" :aria-invalid="passwordTooShort" />
          <p v-if="passwordTooShort" class="field-error">{{ $t('settings.passwordTooShort') }}</p>
        </div>
        <div>
          <label for="s-confirm" class="field-label">{{ $t('settings.confirmPassword') }}</label>
          <input id="s-confirm" v-model="confirmPassword" type="password" class="field-input"
                 autocomplete="new-password" :aria-invalid="passwordMismatch" />
          <p v-if="passwordMismatch" class="field-error">{{ $t('settings.passwordMismatch') }}</p>
        </div>

        <button type="submit" class="btn-primary w-full" :disabled="!canChangePassword">
          {{ savingPassword ? $t('common.loading') : $t('settings.changePassword') }}
        </button>
      </form>
    </section>
  </div>
</template>
