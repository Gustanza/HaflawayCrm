<script setup>
/**
 * One lead in the work queue, as a single row.
 *
 * REPLACES A TABLE, DELIBERATELY. The queue used to render an eight-column `<table
 * class="min-w-[56rem]">`, which on the actual deployment screen meant a horizontal
 * scrollbar and every cell wrapping to two lines — "Evangelist Caleb" on one line,
 * "Haule" on the next, "16 days" above "overdue". A table is the right shape for
 * comparing a column of numbers; this screen is a list of jobs to do, and each job has one
 * name, one thing that happened last time, one time it is due and three actions. So it is
 * a row that REFLOWS instead of a row that scrolls: stacked on a phone, aligned into
 * columns from `lg` up, never wider than the screen at any size.
 *
 * The information is the same set the table carried (§10.3) — nothing was dropped to make
 * it fit, it is only arranged by how an agent reads it:
 *
 *   [AV]  Name              Stage        What happened last     Due        Call WA Log
 *         Phone             Event clock  their own words        Owner
 *
 * Left to right is "who · where they are · what you know · when · what to do", which is
 * the order the question actually gets asked in.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPhone, toTelLink, toWhatsAppLink } from '@/domain/phone.js'
import StageBadge from './StageBadge.vue'
import EventCountdown from './EventCountdown.vue'
import LastContact from './LastContact.vue'
import NextActionCountdown from './NextActionCountdown.vue'

const props = defineProps({
  lead: { type: Object, required: true },
  /** Which queue section this row is sitting in — 'overdue' | 'today' | 'upcoming'. */
  bucket: { type: String, default: 'upcoming' },
  /** Pre-formatted due text for the non-overdue buckets; overdue renders its own pill. */
  due: { type: String, default: '' },
  /** Empty unless the viewer can see other people's leads AND more than one owner is on
      screen — an agent's own name repeated down forty rows is noise, not information. */
  ownerName: { type: String, default: '' },
})

const emit = defineEmits(['log'])
const { t } = useI18n()

const name = computed(() => props.lead.displayName || t('lead.unnamed'))

/**
 * Initials, as the row's anchor. Purely an aid to scanning — it carries no information the
 * name beside it does not, which is why it is `aria-hidden` in the template: a screen
 * reader announcing "E C, Evangelist Caleb" is worse than useless.
 */
const initials = computed(() => {
  const words = (props.lead.displayName ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
})

const isOverdue = computed(() => props.bucket === 'overdue')

const phone = computed(() =>
  formatPhone(props.lead.primaryPhoneNormalized || props.lead.primaryPhone),
)
const telLink = computed(() =>
  toTelLink(props.lead.primaryPhoneNormalized || props.lead.primaryPhone),
)
const whatsappLink = computed(() =>
  toWhatsAppLink(
    props.lead.primaryPhoneNormalized || props.lead.primaryPhone,
    t('lead.whatsappGreeting', { name: props.lead.displayName ?? '' }),
  ),
)
</script>

<template>
  <!--
    ONE grid, two arrangements — not two markup trees behind `hidden` / `lg:hidden`.
    Duplicated rows would double every lead in the tab order and read each one twice to a
    screen reader, so each cell keeps its place explicitly instead:

      phone  (3 columns)          lg and up (5 columns, two rows)
      ┌────┬─────────────────┐    ┌────┬─────────┬────────┬──────┬───────┐
      │ AV │ name            │    │ AV │ name    │ stage  │ due  │       │
      │    │ phone           │    │    │ phone   │ event  │ own  │ acts  │
      ├────┼──────────┬──────┤    │    ├─────────┴────────┴──────┤       │
      │    │ stage    │ due  │    │    │ last contact            │       │
      │    │ event    │      │    └────┴─────────────────────────┴───────┘
      ├────┼──────────┴──────┤
      │    │ last contact    │
      ├────┴─────────────────┤
      │ call · whats · log   │
      └──────────────────────┘

      Two things drove this shape rather than five columns on one line:

      The name gets the full width it needs at every size. "Evangelist Caleb Haule" is how
      an agent recognises who they are about to ring, and squeezed into a fifth of a
      1024px-wide window — the size this is actually used at — it became "Evangelist Cal…".

      And what happened last time is a SENTENCE, not a field. "We spoke — she wants the
      quote by Friday" belongs on a line of its own under the name, the way an email client
      puts the snippet under the subject, rather than in a 150px cell that can only ever
      show its first three words.
  -->
  <article
    class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5
           px-4 py-3.5 transition-colors hover:bg-slate-50 sm:px-5
           lg:grid-cols-[2.5rem_minmax(0,1fr)_minmax(8rem,auto)_minmax(7.5rem,auto)_auto]
           lg:gap-y-0.5 lg:py-3"
  >
    <!-- Who -->
    <div
      class="col-start-1 row-start-1 grid size-10 shrink-0 place-items-center rounded-full
             text-xs font-semibold lg:row-span-2 lg:self-center"
      :class="isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'"
      aria-hidden="true"
    >
      {{ initials }}
    </div>

    <div class="col-start-2 col-span-2 row-start-1 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1">
      <RouterLink
        :to="{ name: 'lead-detail', params: { id: lead.id } }"
        class="block truncate font-semibold text-slate-900 hover:text-brand-700"
      >
        {{ name }}
      </RouterLink>
      <!-- Kept visible even though Call and WhatsApp are one tap away: an agent reads the
           number out to a colleague, or dials it from a second handset, all day. -->
      <p class="mt-0.5 truncate text-xs text-slate-500 tabular-nums">{{ phone }}</p>
    </div>

    <!-- Where the deal is, and the customer's own clock. Two facts that belong together:
         "Quoted, wedding in 3 days" is a different job from "New, wedding in 71 days". -->
    <div
      class="col-start-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1
             lg:col-start-3 lg:row-start-1 lg:flex-nowrap lg:self-center"
    >
      <StageBadge :stage="lead.stage" />
      <EventCountdown :event-date="lead.eventDate" :event-type="lead.eventType" compact />
    </div>

    <!-- What you already know. The reason this row is actionable rather than just late,
         and the line that turns "16 days overdue" into an instruction. -->
    <div class="col-start-2 col-span-2 row-start-3 min-w-0 lg:col-start-2 lg:col-span-3 lg:row-start-2">
      <LastContact :lead="lead" inline />
    </div>

    <!-- When. Right-aligned against the stage on a phone; from `lg` it holds its own
         column so a section can be read down instead of across. -->
    <div
      class="col-start-3 row-start-2 justify-self-end text-right
             lg:col-start-4 lg:row-start-1 lg:justify-self-start lg:self-center lg:text-left"
    >
      <NextActionCountdown v-if="isOverdue" :at="lead.nextActionAt" />
      <span v-else class="text-sm whitespace-nowrap text-slate-600 tabular-nums">{{ due }}</span>
      <p v-if="ownerName" class="mt-0.5 truncate text-xs text-slate-500" :title="ownerName">
        {{ ownerName }}
      </p>
    </div>

    <!-- What to do. Full-width thumb targets on a phone (P7), square icon buttons once
         there is a column for them — same three controls either way, same tab order.
         `lg:w-11` is 2.75rem, the same 44px floor `--spacing-touch` sets: the buttons lose
         their labels on wide screens, never their target size. -->
    <div
      class="col-span-3 col-start-1 row-start-4 flex items-center gap-2
             lg:col-span-1 lg:col-start-5 lg:row-span-2 lg:row-start-1 lg:justify-end lg:self-center"
    >
      <a
        v-if="telLink"
        :href="telLink"
        class="btn-secondary flex-1 text-sm lg:w-11 lg:flex-none lg:px-0"
        :aria-label="`${$t('lead.call')} ${name}`"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        </svg>
        <span class="lg:hidden">{{ $t('lead.call') }}</span>
      </a>

      <a
        v-if="whatsappLink"
        :href="whatsappLink"
        target="_blank"
        rel="noopener"
        class="btn-secondary flex-1 text-sm lg:w-11 lg:flex-none lg:px-0"
        :aria-label="`${$t('lead.whatsapp')} ${name}`"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20zm4.4-5.9c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.5 2.7 2.7 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c0-.1-.2-.2-.4-.3z" />
        </svg>
        <span class="lg:hidden">{{ $t('lead.whatsapp') }}</span>
      </a>

      <!-- The only brand-filled control in the row, because logging the outcome is the one
           action that takes a lead OFF this screen. Call and WhatsApp start the work; this
           is what finishes it. -->
      <button
        type="button"
        class="btn-primary flex-1 text-sm lg:w-11 lg:flex-none lg:px-0"
        :aria-label="`${$t('lead.log')} ${name}`"
        @click="emit('log', lead)"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span class="lg:hidden">{{ $t('lead.log') }}</span>
      </button>
    </div>
  </article>
</template>
