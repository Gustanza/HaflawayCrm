/**
 * Lead scoring — TODO.md §8.7.
 *
 * FIXED FORMULAS, deliberately (P12). No rules engine, no weights in the database, no
 * per-team configuration. Every knob doubles the test surface, and we do not yet have the
 * twelve months of closed-outcome data that would justify tuning anything. When we do, the
 * replacement is a measured model, not an admin screen full of sliders.
 *
 * `priorityScore` decides the order of every agent's work queue, which makes it the single
 * most consequential number in the product: it is what an agent actually acts on all day.
 */

import { daysToEvent } from './periods.js'

/* ---------------------------------------------------------------------------
 * Urgency — the event-date clock (P2)
 * ------------------------------------------------------------------------- */

/**
 * Urgency from days-to-event. Banded, not linear, because the decision behaves in steps:
 * a wedding 6 days out is a different conversation from one 20 days out, while 200 days
 * and 240 days are the same conversation.
 *
 * An unknown event date scores LOW, not zero — the lead is still workable, and the missing
 * date is itself the next action.
 *
 * A PAST event scores 0: the invitations were needed last week. It belongs in `parked`,
 * not at the top of somebody's queue.
 */
export function urgencyScore(days) {
  if (days === null || days === undefined) return 10
  if (days < 0) return 0
  if (days <= 7) return 100
  if (days <= 14) return 85
  if (days <= 30) return 70
  if (days <= 60) return 50
  if (days <= 90) return 30
  return 10
}

/** Convenience so callers need not import periods.js separately. */
urgencyScore.daysFor = (eventDate, now = new Date()) => daysToEvent(eventDate, now)

/** Urgency straight from an event date. */
export function urgencyFromEventDate(eventDate, now = new Date()) {
  return urgencyScore(daysToEvent(eventDate, now))
}

/** Colour band for the urgency board (§12 screen 7). Semantic, not decorative. */
export function urgencyBand(days) {
  if (days === null || days === undefined) return 'unknown'
  if (days < 0) return 'passed'
  if (days <= 7) return 'critical'
  if (days <= 14) return 'high'
  if (days <= 30) return 'medium'
  return 'low'
}

/* ---------------------------------------------------------------------------
 * Qualification — BEDS (§5.3)
 * ------------------------------------------------------------------------- */

const BUDGET_BAND_SCORES = {
  unknown: 0,
  '<50k': 25,
  '50-150k': 50,
  '150-500k': 80,
  '500k+': 100,
}

/**
 * Guest count is the strongest single predictor of deal value in this business: an
 * invitation list of 600 is a different product from a list of 60, whatever the customer
 * says about budget.
 */
function guestCountScore(input) {
  // Coerce: an HTML number input without `.number` yields a string, and rejecting it
  // silently cost the lead 16 qualification points with no error and no signal.
  const count = typeof input === 'string' && input.trim() !== '' ? Number(input) : input
  if (!Number.isFinite(count) || count <= 0) return 0
  if (count >= 500) return 100
  if (count >= 300) return 80
  if (count >= 150) return 60
  if (count >= 50) return 40
  return 20
}

/**
 * 0–100 from the BEDS fields. Weights follow §8.7 and sum to 1.
 * Budget carries the most because it is the answer that most often kills a deal late.
 */
export function qualificationScore(lead) {
  const q = lead?.qualification ?? {}

  const budget = BUDGET_BAND_SCORES[q.budgetBand] ?? 0
  const decisionMaker = q.decisionMakerContactId ? 100 : 0
  const guests = guestCountScore(lead?.guestCountEstimate)
  const scope = Array.isArray(q.interestedProductIds) && q.interestedProductIds.length > 0 ? 100 : 0

  return Math.round(0.35 * budget + 0.25 * decisionMaker + 0.2 * guests + 0.2 * scope)
}

/* ---------------------------------------------------------------------------
 * Engagement
 * ------------------------------------------------------------------------- */

/**
 * How responsive this lead has been. Rewards a recent two-way conversation; penalises a
 * run of unanswered calls.
 *
 * Note the asymmetry: `lastContactedAt` is only set when the outcome was `spoke`
 * (see leads.service.js). A ringing phone is not contact, and counting it as engagement
 * would flatter exactly the leads that deserve the least attention.
 */
export function engagementScore(lead, now = new Date()) {
  const spokeAt = lead?.lastContactedAt
  // `?? 0` guards null and undefined but not NaN or a string, either of which produced a
  // NaN score that propagated into priorityScore and then into a Firestore orderBy.
  const raw = lead?.consecutiveNoAnswer
  const noAnswer = Number.isFinite(raw) ? raw : 0

  let score = 0
  if (spokeAt) {
    const days = Math.abs(daysToEvent(spokeAt, now) ?? 999)
    if (days <= 2) score = 100
    else if (days <= 7) score = 75
    else if (days <= 14) score = 50
    else if (days <= 30) score = 25
    else score = 10
  }

  // Each unanswered attempt costs 15 points. Four in a row and the lead has told us
  // something, even if nobody picked up.
  score -= Math.min(noAnswer, 4) * 15

  return Math.max(0, Math.min(100, Math.round(score)))
}

/* ---------------------------------------------------------------------------
 * Priority — what the work queue sorts on
 * ------------------------------------------------------------------------- */

/**
 * Weighted blend, §8.7: 0.5 urgency + 0.3 qualification + 0.2 engagement.
 *
 * Urgency dominates on purpose. A well-qualified, chatty lead whose event is in seven
 * months can wait; a thinly-qualified one whose wedding is in nine days cannot. That is
 * the whole argument for building this rather than buying a generic CRM (P2).
 *
 * Accepts either pre-computed components or a lead document.
 */
/**
 * Floors applied AFTER the weighted blend, keyed on urgency.
 *
 * WHY THIS EXISTS — a real conflict inside TODO.md, resolved in favour of P2.
 *
 * The §8.7 weights alone do not deliver what P2 promises. Urgency contributes at most 50
 * points, so qualification + engagement (also 50) can outvote it. Worked example:
 *
 *   unqualified lead, event in  9 days, never spoken to  →  0.5·85 + 0 + 0        = 43
 *   perfect lead,     event in 210 days, spoke yesterday →  0.5·10 + 0.3·100 + 20 = 55
 *
 * The blend puts the distant lead first. P2 says the opposite, in as many words:
 * "categorically hotter ... regardless of how enthusiastic they sound."
 *
 * P2 is right, and the reason is asymmetric cost. The next action on the imminent lead is
 * one phone call and the window shuts in nine days. The next action on the distant lead is
 * equally cheap and can happen any time in the next six months. Sorting the cheap
 * irreversible thing below the cheap reversible one is how a wedding gets missed.
 *
 * So: a lead inside a fortnight is pinned near the top whatever else we know about it.
 */
const URGENCY_FLOORS = [
  { maxDays: 7, floor: 90 },
  { maxDays: 14, floor: 75 },
]

function urgencyFloor(days) {
  if (days === null || days === undefined || days < 0) return 0
  return URGENCY_FLOORS.find((f) => days <= f.maxDays)?.floor ?? 0
}

export function priorityScore(input, now = new Date()) {
  let urgency
  let qualification
  let engagement
  let days

  if (input && typeof input.urgency === 'number') {
    ;({ urgency, qualification = 0, engagement = 0, days = null } = input)
    // Recover `days` from an eventDate if the caller supplied one but not the day count.
    //
    // This branch is why the floor silently did nothing in production: recomputeScores()
    // and createLead() both passed pre-computed components WITHOUT `days`, so
    // urgencyFloor(null) returned 0 and every stored priorityScore was the bare blend.
    // The work queue sorts on the STORED value, so the P2 inversion the floor exists to
    // prevent was still live even though priorityScore(leadDocument) behaved correctly.
    if (days === null && input.eventDate !== undefined) {
      days = daysToEvent(input.eventDate, now)
    }
  } else {
    days = daysToEvent(input?.eventDate, now)
    urgency = urgencyScore(days)
    qualification = qualificationScore(input)
    engagement = engagementScore(input, now)
  }

  const clamp = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0)
  const blended = Math.round(
    0.5 * clamp(urgency) + 0.3 * clamp(qualification) + 0.2 * clamp(engagement),
  )
  return clamp(Math.max(blended, urgencyFloor(days)))
}

/**
 * Everything a lead write needs to refresh at once.
 *
 * `daysToEvent` decays on its own, so these must ALSO be recomputed nightly — a lead that
 * nobody touches still gets more urgent every day, and a queue sorted on a stale score
 * quietly buries the leads that matter most (TODO.md Phase 3).
 */
export function recomputeScores(lead, now = new Date()) {
  const days = daysToEvent(lead?.eventDate, now)
  const urgency = urgencyScore(days)
  const qualification = qualificationScore(lead)
  const engagement = engagementScore(lead, now)

  return {
    daysToEvent: days,
    urgencyScore: urgency,
    qualificationScore: qualification,
    // `days` is REQUIRED here, or the urgency floor is skipped and the stored score — the
    // one the work queue actually sorts on — silently loses the P2 guarantee.
    priorityScore: priorityScore({ urgency, qualification, engagement, days }, now),
  }
}
