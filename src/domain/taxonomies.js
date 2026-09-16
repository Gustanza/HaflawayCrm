/**
 * Shared vocabulary — TODO.md §2, §3.
 *
 * Kept in one place so the quick-add chips, the lead/deal forms, filters and the dashboard
 * groupings cannot drift apart. If a value is added here it must also be added to both
 * locale files.
 */

/** What Haflaway sells, in the order the chips should appear — commonest first. */
export const PRODUCT_TYPES = Object.freeze([
  'committee_invite', // Kadi za Mwaliko wa Kamati
  'contribution_reminder', // Reminder za Michango
  'contribution_card', // Kadi za Michango
  'invitation_card', // Kadi za Mwaliko (the event invitation itself)
  'other',
])

/** Event types a lead's occasion can be, in the order the chips should appear. */
export const EVENT_TYPES = Object.freeze([
  'harusi',
  'send_off',
  'kitchen_party',
  'mahafali',
  'kumbukumbu',
  'corporate',
  'other',
])

/** Where a lead came from. */
export const LEAD_SOURCES = Object.freeze([
  'facebook',
  'instagram',
  'whatsapp',
  'committee_visit',
  'referral',
  'walk_in',
  'other',
])

/** Channels a contact attempt can happen through. */
export const CHANNELS = Object.freeze(['call', 'whatsapp', 'sms', 'in_person', 'other'])

/**
 * Call/contact outcomes. Distinct outcomes matter because "switched off" and "no answer"
 * mean different things for how soon to try again.
 */
export const CALL_OUTCOMES = Object.freeze([
  'spoke',
  'no_answer',
  'busy',
  'switched_off',
  'wrong_number',
  'callback_requested',
])

/**
 * The i18n message key for a stored outcome token.
 *
 * The tokens are snake_case (house style for stored enums); the message keys are camelCase
 * (house style for i18n). Centralised so a caller cannot forget the prefix or hand-roll the
 * case conversion and get it wrong.
 */
const OUTCOME_MESSAGE_KEYS = Object.freeze({
  spoke: 'spoke',
  no_answer: 'noAnswer',
  busy: 'busy',
  switched_off: 'switchedOff',
  wrong_number: 'wrongNumber',
  callback_requested: 'callbackRequested',
})

export function outcomeMessageKey(outcome) {
  return `activity.outcome.${OUTCOME_MESSAGE_KEYS[outcome] ?? outcome}`
}

/** A deal's lifecycle — per product, per lead. See TODO.md §3. */
export const DEAL_STATUSES = Object.freeze(['open', 'closed_won', 'closed_lost'])

export function isOpenDeal(status) {
  return status === 'open'
}

export function isClosedDeal(status) {
  return status === 'closed_won' || status === 'closed_lost'
}

/** Why a deal was lost. Free-text notes are expected alongside `other`. */
export const LOST_REASONS = Object.freeze([
  'price',
  'chose_competitor',
  'did_it_themselves',
  'event_cancelled',
  'no_budget',
  'no_response',
  'wrong_fit',
  'other',
])
