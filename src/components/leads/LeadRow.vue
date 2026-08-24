<script setup>
/**
 * One lead in a list. The unit every list screen reuses.
 *
 * TODO.md §10.3 and P7: name · event countdown · last outcome · one-tap actions. Nothing
 * else. The agent is standing up, holding the phone in one hand, at a committee meeting.
 *
 * Call and WhatsApp are real `tel:` / `wa.me` links, so they work from the lock screen and
 * offline — they are the two things an agent does all day, and neither should require the
 * app to be online or even loaded.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import { formatMoney } from '@/domain/money.js'
import { daysToEvent, toDate } from '@/domain/periods.js'
import StageBadge from './StageBadge.vue'
import EventCountdown from './EventCountdown.vue'

const props = defineProps({
  lead: { type: Object, required: true },
  showOwner: { type: Boolean, default: false },
  ownerName: { type: String, default: '' },
})

const emit = defineEmits(['log'])
const { t } = useI18n()

const telLink = computed(() => toTelLink(props.lead.primaryPhoneNormalized || props.lead.primaryPhone))

const whatsappLink = computed(() =>
  toWhatsAppLink(
    props.lead.primaryPhoneNormalized || props.lead.primaryPhone,
    t('lead.whatsappGreeting', { name: props.lead.displayName ?? '' }),
  ),
)

/** Overdue is the loudest thing in the UI (§10.2). */
const isOverdue = computed(() => {
  const next = toDate(props.lead.nextActionAt)
  return next !== null && next.getTime() < Date.now()
})

const daysOverdue = computed(() => {
  const d = daysToEvent(props.lead.nextActionAt)
  return d === null ? null : Math.abs(d)
})
</script>

<template>
  <article
    class="card p-3 sm:p-4"
    :class="isOverdue ? 'ring-rose-300 bg-rose-50/40' : ''"
  >
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <RouterLink
          :to="{ name: 'lead-detail', params: { id: lead.id } }"
          class="block font-medium text-slate-900 hover:text-brand-700 truncate"
        >
          {{ lead.displayName || $t('lead.unnamed') }}
        </RouterLink>

        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" />
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-2">
          <StageBadge :stage="lead.stage" />
          <span v-if="lead.dealValueMinor" class="text-xs text-slate-600">
            {{ formatMoney(lead.dealValueMinor, lead.currency) }}
          </span>
          <span v-if="showOwner && ownerName" class="text-xs text-slate-500 truncate">
            {{ ownerName }}
          </span>
        </div>

        <p v-if="isOverdue" class="mt-1.5 text-xs font-medium text-rose-700">
          {{ daysOverdue ? $t('queue.overdueBy', { count: daysOverdue }) : $t('queue.overdueNow') }}
        </p>

        <p class="mt-1 text-xs text-slate-500 tabular-nums">
          {{ formatPhone(lead.primaryPhoneNormalized || lead.primaryPhone) }}
        </p>
      </div>
    </div>

    <!-- One tap each. 44px targets (P7). -->
    <div class="mt-3 flex items-center gap-2">
      <a
        v-if="telLink"
        :href="telLink"
        class="btn-secondary flex-1 text-sm"
        :aria-label="`${$t('lead.call')} ${lead.displayName}`"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        </svg>
        {{ $t('lead.call') }}
      </a>

      <a
        v-if="whatsappLink"
        :href="whatsappLink"
        target="_blank"
        rel="noopener"
        class="btn-secondary flex-1 text-sm"
        :aria-label="`${$t('lead.whatsapp')} ${lead.displayName}`"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20zm4.4-5.9c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.5 2.7 2.7 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c0-.1-.2-.2-.4-.3z" />
        </svg>
        {{ $t('lead.whatsapp') }}
      </a>

      <button
        type="button"
        class="btn-primary text-sm px-3"
        :aria-label="`${$t('lead.log')} ${lead.displayName}`"
        @click="emit('log', lead)"
      >
        {{ $t('lead.log') }}
      </button>
    </div>
  </article>
</template>
