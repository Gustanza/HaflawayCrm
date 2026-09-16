<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { getDb } from '@/firebase/app.js'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const displayName = ref(auth.profile?.displayName ?? auth.displayName)
watch(
  () => auth.profile?.displayName,
  (value) => {
    if (value != null) displayName.value = value
  },
)
const savingProfile = ref(false)

async function saveProfile() {
  savingProfile.value = true
  try {
    const [db, { doc, updateDoc, serverTimestamp }] = await Promise.all([
      getDb(),
      import('firebase/firestore'),
    ])
    await updateDoc(doc(db, 'users', auth.uid), {
      displayName: displayName.value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.uid,
    })
    await updateDoc(doc(db, 'usersPublic', auth.uid), {
      displayName: displayName.value.trim(),
    })
    ui.success(t('settings.profileSaved'))
  } catch (error) {
    ui.error(t(writeErrorKey(error)))
  } finally {
    savingProfile.value = false
  }
}

async function onSetLocale(locale) {
  await auth.setLocale(locale)
}

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref(null)
const savingPassword = ref(false)

async function changePassword() {
  passwordError.value = null
  if (newPassword.value.length < 8) {
    passwordError.value = t('settings.passwordTooShort')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = t('settings.passwordMismatch')
    return
  }
  savingPassword.value = true
  const ok = await auth.changePassword(currentPassword.value, newPassword.value)
  savingPassword.value = false
  if (ok) {
    ui.success(t('settings.passwordChanged'))
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } else {
    passwordError.value = t(auth.errorKey)
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-6">
    <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.settings') }}</h1>

    <!-- Profile -->
    <section class="card mt-4 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('settings.profile') }}</h2>
      <form class="mt-3 space-y-3" @submit.prevent="saveProfile">
        <div>
          <label for="settings-name" class="field-label">{{ t('settings.displayName') }}</label>
          <input id="settings-name" v-model="displayName" type="text" class="field-input" required />
        </div>
        <div>
          <p class="field-label">{{ t('settings.role') }}</p>
          <p class="text-sm text-slate-700">{{ auth.role ? t(`role.${auth.role}`) : '' }}</p>
        </div>
        <button type="submit" class="btn-primary" :disabled="savingProfile">
          {{ savingProfile ? t('common.loading') : t('common.save') }}
        </button>
      </form>
    </section>

    <!-- Language -->
    <section class="card mt-4 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('common.language') }}</h2>
      <p class="mt-1 text-sm text-slate-600">{{ t('settings.languageHelp') }}</p>
      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors"
          style="min-height: var(--spacing-touch)"
          :class="(auth.locale ?? 'sw') === 'sw'
            ? 'bg-brand-600 text-white ring-brand-600'
            : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
          @click="onSetLocale('sw')"
        >
          {{ t('common.swahili') }}
        </button>
        <button
          type="button"
          class="rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors"
          style="min-height: var(--spacing-touch)"
          :class="auth.locale === 'en'
            ? 'bg-brand-600 text-white ring-brand-600'
            : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'"
          @click="onSetLocale('en')"
        >
          {{ t('common.english') }}
        </button>
      </div>
    </section>

    <!-- Password -->
    <section class="card mt-4 p-4">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">{{ t('settings.password') }}</h2>
      <form class="mt-3 space-y-3" @submit.prevent="changePassword">
        <div>
          <label for="settings-current-pw" class="field-label">{{ t('settings.currentPassword') }}</label>
          <input
            id="settings-current-pw"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            class="field-input"
          />
        </div>
        <div>
          <label for="settings-new-pw" class="field-label">{{ t('settings.newPassword') }}</label>
          <input
            id="settings-new-pw"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            class="field-input"
          />
        </div>
        <div>
          <label for="settings-confirm-pw" class="field-label">{{ t('settings.confirmPassword') }}</label>
          <input
            id="settings-confirm-pw"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            class="field-input"
          />
        </div>
        <p v-if="passwordError" class="field-error" role="alert">{{ passwordError }}</p>
        <button type="submit" class="btn-primary" :disabled="savingPassword">
          {{ savingPassword ? t('common.loading') : t('settings.changePassword') }}
        </button>
      </form>
    </section>
  </div>
</template>
