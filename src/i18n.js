/**
 * Localisation. English only, at the owner's request — the app was originally built
 * Swahili-first with an English fallback (TODO.md §8); `src/locales/sw.json` is kept in the
 * repo, untouched and unreferenced, so Swahili can be reinstated later without redoing the
 * translation work. See git history for how the locale switcher was wired if it comes back.
 */
import { createI18n } from 'vue-i18n'
import en from '@/locales/en.json'

export const SUPPORTED_LOCALES = ['en']

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
  // Missing keys are a bug, not a runtime warning to live with.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', 'en')
}

export default i18n
