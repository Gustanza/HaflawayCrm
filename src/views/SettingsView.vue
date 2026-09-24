<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore, writeErrorKey } from '@/stores/ui.js'
import { getDb } from '@/firebase/app.js'
import { initialsFromName, avatarToneFromSeed } from '@/domain/avatar.js'

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

const initials = computed(() => initialsFromName(displayName.value || auth.displayName))
const tone = computed(() => avatarToneFromSeed(displayName.value || auth.uid))
const email = computed(() => auth.user?.email ?? '')

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

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref(null)
const savingPassword = ref(false)
const showPassword = ref(false)

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
  <div class="page-shell">
    <h1 class="page-title">{{ t('nav.settings') }}</h1>
    <p class="mt-1 text-sm text-slate-600">{{ t('settings.subtitle') }}</p>

    <section class="card mt-6 overflow-hidden rounded-2xl">
      <div class="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <div
          class="flex size-16 shrink-0 items-center justify-center rounded-2xl text-xl font-semibold"
          :class="tone"
          aria-hidden="true"
        >
          {{ initials }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-xl font-semibold tracking-tight text-slate-900">
            {{ auth.displayName }}
          </p>
          <p class="mt-0.5 truncate text-sm text-slate-600">{{ email }}</p>
        </div>
        <p
          v-if="auth.role"
          class="badge shrink-0 bg-brand-50 text-brand-800 ring-brand-600"
        >
          {{ t(`role.${auth.role}`) }}
        </p>
      </div>
      <dl class="grid grid-cols-1 divide-y divide-slate-100 border-t border-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div class="px-5 py-3 sm:px-6">
          <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('settings.email') }}</dt>
          <dd class="mt-1 truncate text-sm font-medium text-slate-900">{{ email }}</dd>
        </div>
        <div class="px-5 py-3 sm:px-6">
          <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('settings.role') }}</dt>
          <dd class="mt-1 text-sm font-medium text-slate-900">
            {{ auth.role ? t(`role.${auth.role}`) : t('common.none') }}
          </dd>
        </div>
      </dl>
    </section>

    <div class="mt-5 grid gap-5 lg:grid-cols-2">
      <section class="card rounded-2xl p-5 sm:p-6">
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-800">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8" />
              <path d="M5 19c.7-3.2 3.2-5 7-5s6.3 1.8 7 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-900">{{ t('settings.profile') }}</h2>
            <p class="mt-0.5 text-sm text-slate-600">{{ t('settings.profileHint') }}</p>
          </div>
        </div>

        <form class="mt-5 space-y-4" @submit.prevent="saveProfile">
          <div>
            <label for="settings-name" class="field-label">{{ t('settings.displayName') }}</label>
            <input id="settings-name" v-model="displayName" type="text" class="field-input" required />
          </div>
          <button type="submit" class="btn-primary w-full" :disabled="savingProfile">
            {{ savingProfile ? t('common.loading') : t('common.save') }}
          </button>
        </form>
      </section>

      <section class="card rounded-2xl p-5 sm:p-6">
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8" />
              <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-slate-900">{{ t('settings.password') }}</h2>
            <p class="mt-0.5 text-sm text-slate-600">{{ t('settings.passwordHint') }}</p>
          </div>
        </div>

        <form class="mt-5 space-y-4" @submit.prevent="changePassword">
          <div>
            <label for="settings-current-pw" class="field-label">{{ t('settings.currentPassword') }}</label>
            <div class="relative">
              <input
                id="settings-current-pw"
                v-model="currentPassword"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="field-input pr-16"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-2 text-sm font-medium text-brand-800"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? t('auth.hidePassword') : t('auth.showPassword') }}
              </button>
            </div>
          </div>
          <div>
            <label for="settings-new-pw" class="field-label">{{ t('settings.newPassword') }}</label>
            <input
              id="settings-new-pw"
              v-model="newPassword"
              :type="showPassword ? 'text' : 'password'"
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
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              required
              minlength="8"
              class="field-input"
            />
          </div>
          <p v-if="passwordError" class="field-error" role="alert">{{ passwordError }}</p>
          <button type="submit" class="btn-primary w-full" :disabled="savingPassword">
            {{ savingPassword ? t('common.loading') : t('settings.changePassword') }}
          </button>
        </form>
      </section>
    </div>
  </div>
</template>
