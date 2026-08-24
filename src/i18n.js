/**
 * Localisation. Swahili is the default (TODO.md §13): sales staff work in Swahili,
 * and the dashboard audience is bilingual. `en` is the fallback so a missing key
 * degrades to English rather than rendering the raw key path to a user.
 */
import { createI18n } from 'vue-i18n'
import sw from '@/locales/sw.json'
import en from '@/locales/en.json'

export const SUPPORTED_LOCALES = ['sw', 'en']

const STORAGE_KEY = 'haflaway.locale'

/** A choice made before sign-in has nowhere else to live — there is no profile yet. */
function storedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return SUPPORTED_LOCALES.includes(value) ? value : null
  } catch {
    return null // private mode, or storage disabled
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: storedLocale() ?? 'sw',
  fallbackLocale: 'en',
  messages: { sw, en },
  // Missing keys are a bug, not a runtime warning to live with.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return
  i18n.global.locale.value = locale
  document.documentElement.setAttribute('lang', locale)
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* not fatal — the choice simply will not survive this session */
  }
}

// Apply immediately, so <html lang> is right on the first paint rather than after mount.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', i18n.global.locale.value)
}

export default i18n
