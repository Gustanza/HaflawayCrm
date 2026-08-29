/**
 * Period keys — timezone-correct bucketing for rollups and range queries.
 *
 * Every business day boundary in Haflaway CRM is `Africa/Dar_es_Salaam` (UTC+3, no DST).
 * NEVER use the browser's local timezone for these: a manager in another timezone opening
 * the dashboard must see the same "today" as the agent in Dar es Salaam.
 *
 * ERROR CONVENTION for this module: an unreadable *value* returns null (or [] for a list).
 * Nothing here throws. Callers must handle null — never coerce it to a default, because a
 * wrong period key silently files a document under a bucket no dashboard will ever read.
 *
 * See TODO.md §6.1.
 */

import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, startOfDay } from 'date-fns'

export const ORG_TIMEZONE = 'Africa/Dar_es_Salaam'

/** Coerce Date | Firestore Timestamp | ISO string | millis into a Date. */
export function toDate(value) {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  // Firestore Timestamp (avoids importing firebase into the pure domain layer)
  if (typeof value.toDate === 'function') return value.toDate()
  // Date.parse() returns NaN on failure and the CSV importer uses it — an Invalid Date
  // here becomes a `dayKey: "NaN-NaN-NaN"` on a real document that no query can find.
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** The same instant, viewed in org time. */
function inOrgTime(value) {
  const d = toDate(value)
  if (d === null || Number.isNaN(d.getTime())) return null
  return new TZDate(d, ORG_TIMEZONE)
}

const pad = (n) => String(n).padStart(2, '0')

/** "2026-08-24" — the org-local calendar day. */
export function dayKey(value) {
  const d = inOrgTime(value)
  if (!d) return null
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "2026-08" — the org-local calendar month. */
export function monthKey(value) {
  const d = inOrgTime(value)
  if (!d) return null
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * "2026-W35" — ISO-8601 week key, computed in org time.
 * ISO weeks start Monday; week 1 is the week containing the first Thursday of the year.
 * The ISO week-year can differ from the calendar year at year boundaries — that is correct
 * and intentional (2027-01-01 may belong to 2026-W53).
 */
export function weekKey(value) {
  const d = inOrgTime(value)
  if (!d) return null

  // Work in plain UTC arithmetic on the org-local Y/M/D to avoid any offset drift.
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const target = new Date(utc)
  const dayNum = (target.getUTCDay() + 6) % 7 // Mon = 0 … Sun = 6
  target.setUTCDate(target.getUTCDate() - dayNum + 3) // the Thursday of this ISO week

  const isoYear = target.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)

  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000))
  return `${isoYear}-W${pad(week)}`
}

/** All three keys at once — what every document write needs. */
export function periodKeys(value) {
  return { dayKey: dayKey(value), weekKey: weekKey(value), monthKey: monthKey(value) }
}

/**
 * Whole calendar days from `from` to `to`, counted in org time.
 * Positive = `to` is in the future. Today = 0. Yesterday = -1.
 * This is the input to urgencyScore (TODO.md §8.7), so it must be calendar-day based:
 * an event "tomorrow at 08:00" is 1 day away even if that is only 14 hours from now.
 */
export function daysBetween(from, to) {
  const a = inOrgTime(from)
  const b = inOrgTime(to)
  if (!a || !b) return null
  return differenceInCalendarDays(startOfDay(b), startOfDay(a))
}

/** Calendar days from now until the event. Null when there is no event date. */
export function daysToEvent(eventDate, now = new Date()) {
  return daysBetween(now, eventDate)
}

/** Start of the org-local day, as a real (UTC-backed) Date suitable for a Firestore query. */
export function startOfOrgDay(value) {
  const d = inOrgTime(value)
  if (!d) return null
  return new Date(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0, ORG_TIMEZONE).getTime())
}

/**
 * Exclusive end of the org-local day — use as `< endOfOrgDay(x)`, never `<=`.
 *
 * Built by constructing the NEXT org-local midnight, not by adding 24h or by date-fns
 * addDays: both of those advance the day in the *host* timezone, so a manager opening the
 * dashboard from a DST zone would get a 23h or 25h "day" on their own transition dates and
 * silently drop (or double-count) leads. The whole point of this module is that everyone
 * sees the same day as the agent in Dar es Salaam.
 */
export function endOfOrgDay(value) {
  const d = inOrgTime(value)
  if (!d) return null
  // Day overflow is handled by the Date constructor: Aug 32 becomes Sep 1.
  return new Date(
    new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0, ORG_TIMEZONE).getTime(),
  )
}

/** Inclusive-start / exclusive-end bounds for a monthKey like "2026-08". */
export function monthBounds(key) {
  // Reject a dayKey ("2026-08-24") outright rather than quietly treating it as a month:
  // passing the wrong key type is a plausible caller mistake and it must not fail open.
  if (!/^\d{4}-\d{2}$/.test(String(key))) return null
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return null
  const start = new Date(new TZDate(y, m - 1, 1, 0, 0, 0, 0, ORG_TIMEZONE).getTime())
  const end = new Date(new TZDate(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0, ORG_TIMEZONE).getTime())
  return { start, end }
}

/**
 * N month keys starting at `from`, going FORWARD, oldest first.
 *
 * The mirror of recentMonthKeys(). Trend charts look backwards at what happened; an events
 * business plans forwards at what is booked — "what does December look like" is a question
 * about work that has not happened yet, and no backwards window can answer it.
 */
export function upcomingMonthKeys(count, from = new Date()) {
  const d = inOrgTime(from)
  if (!d || !Number.isInteger(count) || count <= 0) return []
  const out = []
  for (let i = 0; i < count; i++) {
    const m = d.getMonth() + i
    const year = d.getFullYear() + Math.floor(m / 12)
    const month = ((m % 12) + 12) % 12
    out.push(`${year}-${pad(month + 1)}`)
  }
  return out
}

/**
 * Inclusive-start / exclusive-end bounds spanning a whole list of month keys.
 *
 * What makes a month grid queryable with ONE range read instead of one query per month:
 * `eventDate >= start && eventDate < end` over the first and last month in the window,
 * grouped by month afterwards. Returns null for an empty or unparseable list rather than
 * a bogus range — a wrong range silently returns the wrong leads.
 */
export function monthSpanBounds(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return null
  const sorted = [...keys].sort()
  const first = monthBounds(sorted[0])
  const last = monthBounds(sorted[sorted.length - 1])
  if (!first || !last) return null
  return { start: first.start, end: last.end }
}

/** The N most recent month keys, oldest first — for trend charts. */
export function recentMonthKeys(count, from = new Date()) {
  const d = inOrgTime(from)
  if (!d || !Number.isInteger(count) || count <= 0) return []
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const y = d.getFullYear()
    const m = d.getMonth() - i
    const year = y + Math.floor(m / 12)
    const month = ((m % 12) + 12) % 12
    out.push(`${year}-${pad(month + 1)}`)
  }
  return out
}
