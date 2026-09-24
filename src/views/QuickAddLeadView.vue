<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLeadsStore } from '@/stores/leads.js'
import { useUiStore } from '@/stores/ui.js'
import { writeErrorKey } from '@/stores/ui.js'
import { isValidPhone } from '@/domain/phone.js'
import { LEAD_SOURCES, EVENT_TYPES } from '@/domain/taxonomies.js'
import FollowUpPicker from '@/components/leads/FollowUpPicker.vue'

const router = useRouter()
const { t } = useI18n()
const leadsStore = useLeadsStore()
const ui = useUiStore()

const phone = ref('')
const name = ref('')
const source = ref('')
const eventType = ref('')
const isHot = ref(false)
/** null = contact them now (the default) — the lead shows as New right away. */
const contactAt = ref(null)
const saving = ref(false)
const submitted = ref(false)

/** 'idle' | 'checking' | 'available' | 'duplicate' | 'invalid' */
const phoneStatus = ref('idle')
const duplicate = ref(null)

let debounceId = null

watch(phone, (value) => {
  duplicate.value = null
  if (debounceId) clearTimeout(debounceId)

  const trimmed = value.trim()
  if (!trimmed) {
    phoneStatus.value = 'idle'
    return
  }
  if (!isValidPhone(trimmed)) {
    phoneStatus.value = 'invalid'
    return
  }

  phoneStatus.value = 'checking'
  debounceId = setTimeout(async () => {
    try {
      const result = await leadsStore.checkPhoneAvailable(trimmed)
      if (phone.value.trim() !== trimmed) return // stale response
      if (!result.valid) {
        phoneStatus.value = 'invalid'
      } else if (!result.available) {
        phoneStatus.value = 'duplicate'
        duplicate.value = result
      } else {
        phoneStatus.value = 'available'
      }
    } catch {
      // Non-blocking check — a failed probe (e.g. offline) must not stop capture.
      phoneStatus.value = 'idle'
    }
  }, 400)
})

onBeforeUnmount(() => {
  if (debounceId) clearTimeout(debounceId)
})

async function onSubmit() {
  submitted.value = true
  const trimmed = phone.value.trim()
  if (!trimmed || !isValidPhone(trimmed)) {
    phoneStatus.value = 'invalid'
    return
  }
  if (phoneStatus.value === 'duplicate') return

  saving.value = true
  try {
    const leadId = await leadsStore.createLead({
      primaryPhone: trimmed,
      displayName: name.value,
      source: source.value || 'other',
      eventType: eventType.value || null,
      isHot: isHot.value,
      ...(contactAt.value ? { nextFollowUpAt: contactAt.value } : {}),
    })
    ui.success(t('quickAdd.saved'))
    router.push({ name: 'lead-detail', params: { id: leadId } })
  } catch (error) {
    if (error?.code === 'duplicate-lead') {
      phoneStatus.value = 'duplicate'
      duplicate.value = { leadId: error.leadId, ownerId: error.ownerId }
    } else if (error?.code === 'invalid-phone') {
      phoneStatus.value = 'invalid'
    } else {
      ui.error(t(writeErrorKey(error)))
    }
  } finally {
    saving.value = false
  }
}

function openExisting() {
  if (duplicate.value?.leadId) {
    router.push({ name: 'lead-detail', params: { id: duplicate.value.leadId } })
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-6">
    <h1 class="text-xl font-semibold text-slate-900">{{ t('nav.newLead') }}</h1>
    <p class="mt-1 text-sm text-slate-600">{{ t('quickAdd.subtitle') }}</p>

    <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
      <div>
        <label for="qa-phone" class="field-label">{{ t('lead.phone') }}</label>
        <input
          id="qa-phone"
          v-model="phone"
          type="tel"
          inputmode="tel"
          autofocus
          required
          class="field-input"
          :placeholder="t('quickAdd.phonePlaceholder')"
        />
        <p v-if="phoneStatus === 'checking'" class="mt-1.5 text-sm text-slate-500">
          {{ t('quickAdd.checking') }}
        </p>
        <p v-else-if="phoneStatus === 'invalid' && (submitted || phone)" class="field-error">
          {{ t('quickAdd.invalidPhone') }}
        </p>
        <div
          v-else-if="phoneStatus === 'duplicate'"
          class="mt-2 rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200"
        >
          <p class="text-sm font-medium text-amber-900">{{ t('quickAdd.duplicateTitle') }}</p>
          <p class="mt-1 text-sm text-amber-800">{{ t('quickAdd.duplicateBody') }}</p>
          <button type="button" class="btn-secondary mt-2 text-sm" @click="openExisting">
            {{ t('quickAdd.openExisting') }}
          </button>
        </div>
      </div>

      <div>
        <label for="qa-name" class="field-label">
          {{ t('quickAdd.name') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
        </label>
        <input
          id="qa-name"
          v-model="name"
          type="text"
          class="field-input"
          :placeholder="t('quickAdd.namePlaceholder')"
        />
      </div>

      <div>
        <label for="qa-source" class="field-label">
          {{ t('quickAdd.source') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
        </label>
        <select id="qa-source" v-model="source" class="field-input">
          <option value="">{{ t('common.select') }}</option>
          <option v-for="s in LEAD_SOURCES" :key="s" :value="s">{{ t(`source.${s}`) }}</option>
        </select>
      </div>

      <div>
        <label for="qa-event" class="field-label">
          {{ t('quickAdd.eventType') }} <span class="text-slate-400">({{ t('common.optional') }})</span>
        </label>
        <select id="qa-event" v-model="eventType" class="field-input">
          <option value="">{{ t('common.select') }}</option>
          <option v-for="e in EVENT_TYPES" :key="e" :value="e">{{ t(`eventType.${e}`) }}</option>
        </select>
        <p class="mt-1.5 text-sm text-slate-500">{{ t('quickAdd.eventDateHint') }}</p>
      </div>

      <div>
        <p class="field-label">{{ t('quickAdd.contactWhen') }}</p>
        <FollowUpPicker v-model="contactAt" now-option />
        <p v-if="contactAt" class="mt-1.5 text-sm text-slate-500">{{ t('quickAdd.contactLaterHint') }}</p>
      </div>

      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input v-model="isHot" type="checkbox" class="size-5 rounded ring-1 ring-slate-400" />
        {{ t('quickAdd.hot') }}
      </label>

      <button
        type="submit"
        class="btn-primary w-full"
        :disabled="saving || phoneStatus === 'duplicate'"
      >
        {{ saving ? t('common.loading') : t('quickAdd.save') }}
      </button>
    </form>
  </div>
</template>
