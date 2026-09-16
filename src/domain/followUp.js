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

  if (absDays >= 1) return { key: 'dueDays', count: absDays }
  if (absHours >= 1) return { key: 'dueHours', count: absHours }
  return { key: 'dueMinutes', count: Math.max(absMinutes, 1) }
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
