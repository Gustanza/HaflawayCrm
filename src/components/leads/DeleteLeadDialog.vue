<script setup>
/**
 * Permanently delete a lead — the only irreversible action in the product.
 *
 * Everything about this dialog is deliberately the OPPOSITE of LogActivityDialog next door.
 * That one is built for speed: three taps, optimistic, closes before the write lands (P7,
 * P8). This one is built for friction, because the failure modes are not symmetrical — a
 * mis-logged call is corrected with another call, a mis-deleted lead is gone with its whole
 * timeline and there is nothing to correct it with.
 *
 * So: it names exactly what will be destroyed BEFORE asking, it requires the lead's name to
 * be typed out, it requires a written reason that goes into the tombstone, and it awaits the
 * cascade instead of firing and forgetting — offline, it refuses outright rather than
 * queueing a multi-step destruction to run unattended hours later.
 */
import { computed, ref, onMounted, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { deleteLead, LEAD_SUBCOLLECTIONS } from '@/services/leads.service.js'

const props = defineProps({
  lead: { type: Object, required: true },
  /** What the cascade will remove, counted by the caller. Null while still counting. */
  inventory: { type: Object, default: null },
})

const emit = defineEmits(['close', 'deleted'])

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const panel = useTemplateRef('panel')

const typedName = ref('')
const reason = ref('')
const deleting = ref(false)
const step = ref(null)

/** The exact string the admin has to reproduce. Trimmed, but case-sensitive. */
const requiredName = computed(() => (props.lead.displayName || '').trim())

/**
 * A lead with no name would otherwise be undeletable, since there would be nothing to
 * type. Fall back to the id, which is visible on the confirmation line below.
 */
const confirmTarget = computed(() => requiredName.value || props.lead.id)

const nameMatches = computed(() => typedName.value.trim() === confirmTarget.value)
const hasReason = computed(() => reason.value.trim().length > 0)
const canDelete = computed(() => nameMatches.value && hasReason.value && !deleting.value)

/** Only the non-zero rows — "0 quotes" is noise in a list meant to be read carefully. */
const inventoryRows = computed(() => {
  if (!props.inventory) return []
  return LEAD_SUBCOLLECTIONS.filter((name) => props.inventory[name] > 0).map((name) => ({
    name,
    count: props.inventory[name],
  }))
})

async function confirm() {
  if (!canDelete.value) return

  // Refuse rather than queue. A cascade committed offline would run days later, out of
  // order, against a lead the admin can no longer see to verify — see deleteLead().
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    ui.error(t('deleteLead.offline'))
    return
  }

  deleting.value = true
  try {
    const report = await deleteLead({
      lead: props.lead,
      user: { uid: auth.uid, role: auth.role, orgId: auth.orgId, displayName: auth.displayName },
      reason: reason.value,
      onProgress: ({ step: s }) => (step.value = s),
    })
    ui.success(t('deleteLead.done'))
    emit('deleted', report)
  } catch (error) {
    // Never close on failure. A partial cascade is recoverable by running again, and the
    // admin can only do that if the dialog is still in front of them.
    ui.error(error?.message || t('errors.write.generic'))
    deleting.value = false
    step.value = null
  }
}

onMounted(async () => {
  await nextTick()
  panel.value?.focus()
})

function onKeydown(event) {
  if (event.key === 'Escape' && !deleting.value) emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
    <div class="absolute inset-0 bg-slate-900/50" aria-hidden="true" @click="deleting || emit('close')" />

    <div
      ref="panel"
      class="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl
             max-h-[90dvh] overflow-y-auto focus:outline-none"
      style="padding-bottom: max(1rem, env(safe-area-inset-bottom))"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="$t('deleteLead.title')"
      @keydown="onKeydown"
    >
      <header class="px-4 pt-4 pb-3 border-b border-slate-200">
        <h2 class="font-semibold text-rose-700">{{ $t('deleteLead.title') }}</h2>
        <p class="mt-0.5 text-sm text-slate-600">
          {{ $t('deleteLead.subtitle', { name: confirmTarget }) }}
        </p>
      </header>

      <div class="px-4 py-4 space-y-4">
        <!-- Say what goes, before asking. An admin who cannot see that this lead carries 47
             logged calls cannot make an informed decision about destroying them. -->
        <section class="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-rose-800">
            {{ $t('deleteLead.willRemove') }}
          </h3>
          <ul class="mt-2 space-y-1 text-sm text-rose-900">
            <li>{{ $t('deleteLead.theLead') }}</li>
            <li v-for="row in inventoryRows" :key="row.name">
              {{ $t(`deleteLead.count.${row.name}`, { count: row.count }) }}
            </li>
            <li v-if="lead.primaryPhoneNormalized">{{ $t('deleteLead.phoneLock') }}</li>
          </ul>
          <p class="mt-2 text-xs text-rose-700">{{ $t('deleteLead.irreversible') }}</p>
        </section>

        <!-- Named explicitly because it is the consequence nobody predicts: the money
             ledger is immutable, so deleting a won lead moves a historical CAC. -->
        <p v-if="lead.leadStatus === 'won' || lead.stage === 'won'" class="text-xs text-amber-700">
          {{ $t('deleteLead.cacWarning') }}
        </p>

        <div>
          <label for="delete-reason" class="field-label">{{ $t('deleteLead.reason') }}</label>
          <input
            id="delete-reason"
            v-model="reason"
            type="text"
            class="field-input"
            :disabled="deleting"
            :placeholder="$t('deleteLead.reasonPlaceholder')"
          />
          <p class="mt-1 text-xs text-slate-500">{{ $t('deleteLead.reasonHelp') }}</p>
        </div>

        <div>
          <label for="delete-confirm" class="field-label">
            {{ $t('deleteLead.typeName', { name: confirmTarget }) }}
          </label>
          <input
            id="delete-confirm"
            v-model="typedName"
            type="text"
            class="field-input"
            autocomplete="off"
            :disabled="deleting"
          />
        </div>

        <p v-if="deleting" class="text-sm text-slate-600" role="status">
          {{ step ? $t(`deleteLead.step.${step}`) : $t('common.loading') }}
        </p>

        <div class="flex gap-2">
          <button
            type="button"
            class="btn-secondary flex-1"
            :disabled="deleting"
            @click="emit('close')"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white
                   hover:bg-rose-700 disabled:opacity-40 disabled:hover:bg-rose-600"
            style="min-height: 2.75rem"
            :disabled="!canDelete"
            @click="confirm"
          >
            {{ deleting ? $t('deleteLead.deleting') : $t('deleteLead.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
