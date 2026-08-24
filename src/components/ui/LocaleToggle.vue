<script setup>
/**
 * Language switch — TODO.md §13 requires the locale to be switchable.
 *
 * Before this existed, `auth.locale` read the profile document, which does not exist until
 * after sign-in. That made the login screen permanently Swahili: an English-speaking
 * finance hire or an external admin could not read "Ingia" and had no control to change it.
 *
 * The choice is kept in localStorage so it survives to the next visit and applies BEFORE
 * anyone signs in. Once signed in, the profile document takes over as the source of truth
 * and this writes through to it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED_LOCALES } from '@/i18n.js'
import { useAuthStore } from '@/stores/auth.js'

const { locale } = useI18n()
const auth = useAuthStore()

const options = computed(() =>
  SUPPORTED_LOCALES.map((code) => ({
    code,
    label: code === 'sw' ? 'SW' : 'EN',
    fullLabel: code === 'sw' ? 'Kiswahili' : 'English',
  })),
)

async function choose(code) {
  if (code === locale.value) return
  setLocale(code)
  // Persist to the profile too, so the choice follows the user to another device.
  if (auth.isSignedIn && auth.canUseApp) {
    try {
      await auth.setLocale(code)
    } catch {
      // Offline, or no permission yet. The local choice already applied, which is what
      // the user asked for; the profile write can wait.
    }
  }
}
</script>

<template>
  <div
    class="inline-flex rounded-lg ring-1 ring-slate-500 ring-inset overflow-hidden"
    role="group"
    :aria-label="$t('common.language')"
  >
    <button
      v-for="option in options"
      :key="option.code"
      type="button"
      class="px-3 text-sm font-medium transition-colors"
      style="min-height: var(--spacing-touch)"
      :class="
        locale === option.code
          ? 'bg-brand-600 text-white'
          : 'bg-white text-slate-600 hover:bg-slate-50'
      "
      :aria-pressed="locale === option.code"
      :aria-label="option.fullLabel"
      @click="choose(option.code)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
