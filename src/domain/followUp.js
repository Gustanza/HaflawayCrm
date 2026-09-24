/**
 * Follow-up scheduling and Work Queue bucketing — TODO.md §1, §5 screen 2.
 *
 * There is no fixed cadence here. Unlike a generic CRM's "call every 3 days", Haflaway's
 * follow-up timing is whatever the rep and the client agreed to — sometimes minutes away.
 * `nextFollowUpAt` is the single source of truth for urgency in this product; it is NOT
 * derived from an event date.
 *
 * ERROR CONVENTION: an unreadable value returns null, never throws — a bad follow-up
 * timestamp must not crash the queue screen for everyone.
 */

import { toDate, startOfOrgDay, endOfOrgDay } from './periods.js'

/** Quick-pick offsets for the "remind me…" control (TODO.md §6 / §5 screen 4). */
export const QUICK_CHIPS = Object.freeze(['2h', 'tomorrow9am', '3d', '1w'])

/**
 * Resolve a quick-chip id to a concrete Date, relative to `now`.
 * `tomorrow9am` is anchored to the org-local calendar day, so a rep working past midnight
 * still gets "tomorrow" in Dar es Salaam time, not in their phone's local time.
 */
export function resolveQuickChip(chipId, now = new Date()) {
  const base = toDate(now)
  if (!base) return null

  switch (chipId) {
    case '2h':
      return new Date(base.getTime() + 2 * 60 * 60 * 1000)
    case 'tomorrow9am': {
      const startOfToday = startOfOrgDay(base)
      if (!startOfToday) return null
      return new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
    }
    case '3d':
      return new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000)
    case '1w':
      return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000)
    default:
      return null
  }
}

/**
 * Which Work Queue section a lead belongs in, from its `nextFollowUpAt`.
 * Returns null when there is no follow-up set at all (a lead with every deal closed, or one
 * that has never been contacted and has no scheduled action yet — the UI treats that as
 * "needs a first touch", not as part of the timed queue).
 */
export function queueBucket(nextFollowUpAt, now = new Date()) {
  const due = toDate(nextFollowUpAt)
  const current = toDate(now)
  if (!due || !current) return null

  if (due.getTime() < current.getTime()) return 'overdue'

  const todayEnd = endOfOrgDay(current)
  if (todayEnd && due.getTime() < todayEnd.getTime()) return 'today'

  return 'upcoming'
}

/**
 * A structured description of "how far" a follow-up is, as an i18n key + params rather than
 * a hard-coded string — the UI resolves `followUp.<key>` against the active locale.
 */
export function describeFollowUp(nextFollowUpAt, now = new Date()) {
  const due = toDate(nextFollowUpAt)
  const current = toDate(now)
  if (!due || !current) return null

  const diffMs = due.getTime() - current.getTime()
  const absMinutes = Math.floor(Math.abs(diffMs) / 60000)
  const absHours = Math.floor(absMinutes / 60)
  const absDays = Math.floor(absHours / 24)

  if (diffMs < 0) {
    if (absDays >= 1) return { key: 'overdueDays', count: absDays }
    if (absHours >= 1) return { key: 'overdueHours', count: absHours }
    return { key: 'overdueNow', count: 0 }
  }

  // Future times ROUND rather than floor. Flooring made "remind me in 2 hours" read back as
  // "in 1h" a second after saving, which looks like the reminder was not taken.
  const minutesAhead = Math.ceil(diffMs / 60000)
  const hoursAhead = Math.round(minutesAhead / 60)
  const daysAhead = Math.round(minutesAhead / (60 * 24))

  if (hoursAhead >= 24) return { key: 'dueDays', count: Math.max(daysAhead, 1) }
  if (minutesAhead >= 60) return { key: 'dueHours', count: hoursAhead }
  return { key: 'dueMinutes', count: Math.max(minutesAhead, 1) }
}

/* --------------------------------------------------------------- never-contacted leads */

/**
 * How long a brand-new lead is "New" before it counts as overdue. A lead that has just been
 * added is not late — it is the most promising contact in the book — but one nobody has
 * tried in a day has been dropped, and the queue should say so.
 */
export const NEW_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000

/** No contact of any kind has been logged — answered or not, every attempt counts. */
export function isNeverContacted(lead) {
  return Boolean(lead) && !lead.lastActivityAt
}

/**
 * When a never-contacted lead became due: its scheduled first contact (the moment it was
 * added, when "Now" was picked), falling back to creation time for older documents.
 */
function firstContactDue(lead, current) {
  return toDate(lead.nextFollowUpAt) ?? toDate(lead.createdAt) ?? current
}

/**
 * The Work Queue section for a whole LEAD — 'new' | 'overdue' | 'today' | 'upcoming' | null.
 * Use this, not queueBucket(), wherever a lead is shown: it knows that a lead nobody has
 * contacted yet is New for its first 24 hours, not overdue from its first second.
 */
export function leadBucket(lead, now = new Date()) {
  const current = toDate(now)
  if (!lead || !current) return null
  if (!isNeverContacted(lead)) return queueBucket(lead.nextFollowUpAt, current)

  const due = firstContactDue(lead, current)
  // Scheduled for later ("call me tomorrow") — an ordinary upcoming follow-up until then.
  if (due.getTime() > current.getTime()) return queueBucket(due, current)
  return current.getTime() - due.getTime() < NEW_LEAD_WINDOW_MS ? 'new' : 'overdue'
}

/**
 * The badge text for a whole lead, as an i18n key + params. Never-contacted leads say how
 * long they have been waiting ("New · added 10 min ago", "Not contacted · 3 days");
 * everything else falls through to describeFollowUp().
 */
export function describeLead(lead, now = new Date()) {
  const current = toDate(now)
  if (!lead || !current) return null
  if (!isNeverContacted(lead)) return describeFollowUp(lead.nextFollowUpAt, current)

  const due = firstContactDue(lead, current)
  if (due.getTime() > current.getTime()) return describeFollowUp(due, current)

  const waitingSince = toDate(lead.createdAt) ?? due
  const minutes = Math.max(0, Math.floor((current.getTime() - waitingSince.getTime()) / 60000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (current.getTime() - due.getTime() < NEW_LEAD_WINDOW_MS) {
    if (minutes < 1) return { key: 'newJustNow', count: 0 }
    if (hours < 1) return { key: 'newMinutes', count: minutes }
    return { key: 'newHours', count: hours }
  }
  if (days >= 1) return { key: 'notContactedDays', count: days }
  return { key: 'notContactedHours', count: Math.max(hours, 1) }
}

/**
 * Sort leads for the Work Queue: overdue-first (most overdue first), then today, then
 * upcoming (soonest first). Leads with no `nextFollowUpAt` sort last — they need a first
 * touch, not a scheduled one, and do not belong ahead of someone who is actually due.
 */
export function sortByFollowUp(leads, now = new Date(), getFollowUpAt = (l) => l.nextFollowUpAt) {
  const current = toDate(now)?.getTime() ?? Date.now()

  const withTime = (lead) => {
    const d = toDate(getFollowUpAt(lead))
    return d ? d.getTime() : null
  }

  return [...leads].sort((a, b) => {
    const ta = withTime(a)
    const tb = withTime(b)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1

    const aOverdue = ta < current
    const bOverdue = tb < current
    // Both overdue: most overdue (smallest/oldest timestamp) first.
    if (aOverdue && bOverdue) return ta - tb
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
    // Both due in the future: soonest first.
    return ta - tb
  })
}
