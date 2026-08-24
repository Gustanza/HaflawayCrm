<script setup>
/**
 * Quick-add — the ≤20-second budget (TODO.md P7), and the phone lock (§6.4).
 *
 * Design rules, all of them load-bearing:
 *   - PHONE FIRST and autofocused. It is the identity, the dedupe key, and the only field
 *     that is genuinely required. An agent can capture a lead knowing nothing else.
 *   - The duplicate check runs WHILE they type, so "this belongs to Frank" appears before
 *     they have finished, not after they submit.
 *   - Event type and date are chips and a date input, not dropdowns — one tap each.
 *   - Save is never blocked on the network (P8). Firestore queues it; the agent moves on.
 *
 * Everything else — budget, guest count, decision maker — belongs on the lead detail
 * screen, entered later when there is actually an answer. Asking for it here would trade
 * a 20-second capture for a 2-minute form, and the form would simply not get used.
 */
import { ref, computed, watch, onMounted, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { createLead, checkPhoneAvailable, DuplicateLeadError, InvalidPhoneError } from '@/services/leads.service.js'
import { formatAsYouType, normalizePhone } from '@/domain/phone.js'
import { EVENT_TYPES, LEAD_SOURCES } from '@/domain/taxonomies.js'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const phoneInput = useTemplateRef('phoneInput')

const phone = ref('')
const displayName = ref('')
const eventType = ref('harusi')
const eventDate = ref('')
const source = ref('whatsapp')
const saving = ref(false)

/** Result of the live availability probe. Advisory only — the transaction is the lock. */
const duplicate = ref(null)
const checking = ref(false)

const normalized = computed(() => normalizePhone(phone.value))
const phoneValid = computed(() => normalized.value !== null)
const canSave = computed(() => phoneValid.value && !saving.value && !duplicate.value)

// Format as the agent types, so they can see they typed it right without re-reading digits.
watch(phone, (value) => {
  const formatted = formatAsYouType(value)
  if (formatted !== value) phone.value = formatted
})

/**
 * Warn about a duplicate BEFORE submit (P7). Debounced, and deliberately not awaited by
 * anything — a slow or offline check must never delay the agent.
 */
let probeTimer = null
watch(normalized, (e164) => {
  duplicate.value = null
  clearTimeout(probeTimer)
  if (!e164) return

  probeTimer = setTimeout(async () => {
    checking.value = true
    try {
      const result = await checkPhoneAvailable(e164, auth.orgId)
      duplicate.value = result.valid && !result.available ? result : null
    } catch {
      // Offline: we simply cannot know yet. The transaction will catch it on sync.
      duplicate.value = null
    } finally {
      checking.value = false
    }
  }, 400)
})

async function save() {
  if (!canSave.value) return
  saving.value = true

  try {
    const id = await createLead({
      input: {
        primaryPhone: phone.value,
        displayName: displayName.value,
        eventType: eventType.value,
        eventDate: eventDate.value ? new Date(eventDate.value) : null,
        source: source.value,
        channel: source.value,
        // A brand-new lead is due for a first call now — otherwise it is invisible to the
        // work queue, which is where it needs to appear (§10.3).
        nextActionAt: new Date(),
        nextActionType: 'call',
      },
      user: { uid: auth.uid, orgId: auth.orgId, teamId: auth.teamId, displayName: auth.displayName },
    })

    ui.success(t('quickAdd.saved'))
    router.replace({ name: 'lead-detail', params: { id } })
  } catch (error) {
    if (error instanceof DuplicateLeadError) {
      duplicate.value = { leadId: error.leadId, ownerId: error.ownerId }
      ui.error(t('quickAdd.duplicate'))
    } else if (error instanceof InvalidPhoneError) {
      ui.error(t('quickAdd.invalidPhone'))
    } else {
      ui.error(t('errors.write.generic'))
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => phoneInput.value?.focus())
</script>

<template>
  <div class="p-4 sm:p-6 max-w-md mx-auto">
    <h1 class="text-xl font-semibold text-slate-900">{{ $t('nav.newLead') }}</h1>
    <p class="mt-0.5 mb-5 text-sm text-slate-500">{{ $t('quickAdd.subtitle') }}</p>

    <form class="space-y-5" novalidate @submit.prevent="save">
      <!-- Phone first: the identity and the dedupe key (§6.4). -->
      <div>
        <label for="qa-phone" class="field-label">
          {{ $t('lead.phone') }} <span class="text-rose-600">*</span>
        </label>
        <input
          id="qa-phone"
          ref="phoneInput"
          v-model="phone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          class="field-input text-lg tabular-nums"
          placeholder="0712 345 678"
          :aria-invalid="phone.length > 3 && !phoneValid"
          :aria-describedby="duplicate ? 'qa-dup' : undefined"
        />
        <p v-if="phone.length > 3 && !phoneValid" class="field-error">
          {{ $t('quickAdd.invalidPhone') }}
        </p>
        <p v-else-if="checking" class="mt-1.5 text-sm text-slate-500">
          {{ $t('quickAdd.checking') }}
        </p>
      </div>

      <!-- The §6.4 collision, surfaced before submit rather than after. -->
      <div
        v-if="duplicate"
        id="qa-dup"
        class="rounded-lg bg-amber-50 ring-1 ring-amber-300 p-3"
        role="alert"
      >
        <p class="text-sm font-medium text-amber-900">{{ $t('quickAdd.duplicateTitle') }}</p>
        <p class="mt-1 text-sm text-amber-800">{{ $t('quickAdd.duplicateBody') }}</p>
        <RouterLink
          v-if="duplicate.leadId"
          :to="{ name: 'lead-detail', params: { id: duplicate.leadId } }"
          class="btn-secondary mt-3 text-sm"
        >
          {{ $t('quickAdd.openExisting') }}
        </RouterLink>
      </div>

      <div>
        <label for="qa-name" class="field-label">
          {{ $t('quickAdd.name') }}
          <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
        </label>
        <input
          id="qa-name"
          v-model="displayName"
          type="text"
          class="field-input"
          autocomplete="off"
          :placeholder="$t('quickAdd.namePlaceholder')"
        />
      </div>

      <fieldset>
        <legend class="field-label">{{ $t('quickAdd.eventType') }}</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="type in EVENT_TYPES"
            :key="type"
            type="button"
            class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                   bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                   data-[on=true]:ring-brand-600"
            style="min-height: var(--spacing-touch)"
            :data-on="eventType === type"
            :aria-pressed="eventType === type"
            @click="eventType = type"
          >
            {{ $t(`eventType.${type}`) }}
          </button>
        </div>
      </fieldset>

      <div>
        <label for="qa-date" class="field-label">
          {{ $t('lead.eventDate') }}
          <span class="font-normal text-slate-400">· {{ $t('common.optional') }}</span>
        </label>
        <input id="qa-date" v-model="eventDate" type="date" class="field-input" />
        <p class="mt-1.5 text-xs text-slate-500">{{ $t('quickAdd.eventDateHint') }}</p>
      </div>

      <fieldset>
        <legend class="field-label">{{ $t('quickAdd.source') }}</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="option in LEAD_SOURCES"
            :key="option"
            type="button"
            class="rounded-full px-4 text-sm font-medium ring-1 ring-inset ring-slate-400
                   bg-white text-slate-700 data-[on=true]:bg-brand-600 data-[on=true]:text-white
                   data-[on=true]:ring-brand-600"
            style="min-height: var(--spacing-touch)"
            :data-on="source === option"
            :aria-pressed="source === option"
            @click="source = option"
          >
            {{ $t(`source.${option}`) }}
          </button>
        </div>
      </fieldset>

      <div class="flex gap-2 pt-1">
        <button type="button" class="btn-secondary flex-1" @click="router.back()">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary flex-1" :disabled="!canSave">
          {{ saving ? $t('common.loading') : $t('quickAdd.save') }}
        </button>
      </div>
    </form>
  </div>
</template>
