<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED_LOCALES } from '@/i18n.js'

const { locale, t } = useI18n()

const other = computed(() => (locale.value === 'sw' ? 'en' : 'sw'))
const otherLabel = computed(() => (other.value === 'sw' ? t('common.swahili') : t('common.english')))

function toggle() {
  const next = SUPPORTED_LOCALES.includes(other.value) ? other.value : 'sw'
  setLocale(next)
}
</script>

<template>
  <button
    type="button"
    class="btn-ghost text-sm"
    :aria-label="t('common.language')"
    @click="toggle"
  >
    {{ otherLabel }}
  </button>
</template>
