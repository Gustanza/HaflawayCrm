/**
 * Shared vocabulary — TODO.md §4.
 *
 * Kept in one place so the quick-add chips, the seed script, the filters and the analytics
 * groupings cannot drift apart. If a value is added here it must also be added to both
 * locale files; tests/unit/taxonomies.test.js enforces that.
 */

/** Event types, in the order the chips should appear — commonest first (P7). */
export const EVENT_TYPES = Object.freeze([
  'harusi',
  'send_off',
  'kitchen_party',
  'mahafali',
  'kumbukumbu',
  'corporate',
  'other',
])

/** Where a lead came from. Frozen onto `attribution` at creation and never edited (P5). */
export const LEAD_SOURCES = Object.freeze([
  'whatsapp',
  'instagram',
  'facebook',
  'field',
  'referral',
  'walk_in',
  'other',
])

/** Channels an interaction can happen through. */
export const CHANNELS = Object.freeze([
  'call',
  'whatsapp',
  'sms',
  'in_person',
  'facebook',
  'instagram',
  'email',
])

/**
 * Call outcomes. Borrowed from Close.com (§3) because a CRM built for high-volume calling
 * has already learned which distinctions matter — "switched off" and "no answer" mean
 * different things to a follow-up cadence.
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
 * The tokens are snake_case because that is the house style for stored enums; the message
 * keys are camelCase because that is the house style for i18n. Something has to bridge
 * them, and until now three places each did it their own way - an array in
 * LogActivityDialog, a four-deep nested ternary inside a LeadDetailView template, and any
 * new caller that had to rediscover the problem. A third caller got it wrong and rendered
 * the raw key `activity.outcome.no_answer` to the user, which is what prompted this.
 *
 * Returns the full key so callers cannot forget the prefix.
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

/** Budget bands, TZS. `unknown` is an explicit "not yet established", not a null. */
export const BUDGET_BANDS = Object.freeze(['unknown', '<50k', '50-150k', '150-500k', '500k+'])
