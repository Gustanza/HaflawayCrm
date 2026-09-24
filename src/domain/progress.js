/**
 * Progress reporting — the Dashboard's arithmetic, kept free of Firebase so it can be tested.
 *
 * Ranges are built from DAY KEYS ("2026-09-24", org time), not from the stored `weekKey`.
 * The stored week is ISO (Monday-first); Haflaway's working week starts on SUNDAY. Every
 * activity, lead and deal already carries its org-local day, so any week definition can be
 * rebuilt from days without rewriting a single stored document.
 *
 * Date arithmetic below runs on UTC-midnight Dates that stand for org-local calendar days.
 * It never touches the host timezone, so a manager abroad sees the same week as Dar es Salaam.
 */

import { dayKey, toDate } from './periods.js'
import { leadBucket } from './followUp.js'
import { PRODUCT_TYPES, LOST_REASONS } from './taxonomies.js'

export const PERIODS = Object.freeze(['day', 'week', 'month', 'quarter'])

/* ------------------------------------------------------------------ calendar days */

const pad = (n) => String(n).padStart(2, '0')

function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDay(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function addDays(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n))
}

/** Every day key from `start` to `end`, inclusive. */
export function daysInRange({ start, end }) {
  const out = []
  for (let d = parseDay(start), last = parseDay(end); d <= last; d = addDays(d, 1)) out.push(formatDay(d))
  return out
}

/**
 * The org-local day range for a period containing `now`: { start, end } as inclusive day
 * keys. Weeks run Sunday → Saturday.
 */
export function periodRange(period, now = new Date()) {
  const today = parseDay(dayKey(now))
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  switch (period) {
    case 'day':
      return { start: formatDay(today), end: formatDay(today) }
    case 'week': {
      const sunday = addDays(today, -today.getUTCDay())
      return { start: formatDay(sunday), end: formatDay(addDays(sunday, 6)) }
    }
    case 'month':
      return { start: formatDay(new Date(Date.UTC(y, m, 1))), end: formatDay(new Date(Date.UTC(y, m + 1, 0))) }
    case 'quarter': {
      const q = Math.floor(m / 3) * 3
      return { start: formatDay(new Date(Date.UTC(y, q, 1))), end: formatDay(new Date(Date.UTC(y, q + 3, 0))) }
    }
    default:
      throw new Error(`Unknown period "${period}"`)
  }
}

/** The period immediately before the one containing `now` — what "▲ 3" is measured against. */
export function previousPeriodRange(period, now = new Date()) {
  const { start } = periodRange(period, now)
  // The day before this period starts is, by definition, inside the previous one. Build a
  // real instant at noon org time (UTC+3) so dayKey() lands on that same calendar day.
  const dayBefore = addDays(parseDay(start), -1)
  return periodRange(period, new Date(dayBefore.getTime() + 9 * 60 * 60 * 1000))
}

const inRange = (key, { start, end }) => typeof key === 'string' && key >= start && key <= end

/* ------------------------------------------------------------------------ buckets */

const SHORT_DAY = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' })
const SHORT_MONTH = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })
const DAY_MONTH = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * How a period splits for the progress chart: days of a week, Sunday-weeks of a month,
 * months of a quarter. A single day has nothing to split — returns [].
 * Each bucket: { label, start, end } with inclusive day keys.
 */
export function periodBuckets(period, range) {
  const days = daysInRange(range)

  if (period === 'week') {
    return days.map((d) => ({ label: SHORT_DAY.format(parseDay(d)), start: d, end: d }))
  }

  if (period === 'month') {
    const buckets = []
    for (const d of days) {
      const date = parseDay(d)
      if (!buckets.length || date.getUTCDay() === 0) buckets.push({ start: d, end: d })
      else buckets[buckets.length - 1].end = d
    }
    return buckets.map((b) => ({
      ...b,
      label: b.start === b.end
        ? DAY_MONTH.format(parseDay(b.start))
        : `${parseDay(b.start).getUTCDate()}–${DAY_MONTH.format(parseDay(b.end))}`,
    }))
  }

  if (period === 'quarter') {
    const buckets = []
    for (const d of days) {
      const month = d.slice(0, 7)
      if (!buckets.length || buckets[buckets.length - 1].month !== month) buckets.push({ month, start: d, end: d })
      else buckets[buckets.length - 1].end = d
    }
    return buckets.map(({ start, end }) => ({ label: SHORT_MONTH.format(parseDay(start)), start, end }))
  }

  return []
}

/* ------------------------------------------------------------------------ metrics */

/**
 * The shapes this module works on — plain objects, mapped from Firestore by the store:
 *   activity: { leadId, dayKey, at, outcome, byUserId, isVoided }
 *   lead:     { id, dayKey, ownerId }            (created in the period)
 *   deal:     { id, leadId, productType, status, closedDayKey, closedBy, lostReason }
 */

const zeroed = (keys) => Object.fromEntries(keys.map((k) => [k, 0]))

/**
 * Headline numbers for one range. "Worked on" counts PEOPLE, not log entries: three calls
 * to Fatuma in a week is one person worked on. Every attempt counts; "reached" is the
 * subset where the outcome was an actual conversation.
 */
export function summarise({ activities, leads, deals }, range) {
  const live = activities.filter((a) => !a.isVoided && inRange(a.dayKey, range))
  const won = deals.filter((d) => d.status === 'closed_won' && inRange(d.closedDayKey, range))
  const lost = deals.filter((d) => d.status === 'closed_lost' && inRange(d.closedDayKey, range))

  const wonByProduct = zeroed(PRODUCT_TYPES)
  for (const d of won) wonByProduct[d.productType] = (wonByProduct[d.productType] ?? 0) + 1
  const lostByReason = zeroed(LOST_REASONS)
  for (const d of lost) lostByReason[d.lostReason] = (lostByReason[d.lostReason] ?? 0) + 1

  return {
    newLeads: leads.filter((l) => inRange(l.dayKey, range)).length,
    attempts: live.length,
    workedOn: new Set(live.map((a) => a.leadId)).size,
    reached: new Set(live.filter((a) => a.outcome === 'spoke').map((a) => a.leadId)).size,
    won: won.length,
    wonClients: new Set(won.map((d) => d.leadId)).size,
    lost: lost.length,
    wonByProduct,
    lostByReason,
  }
}

/** The chart series: people worked on and deals won, per bucket. */
export function bucketSeries(data, buckets) {
  return buckets.map((b) => {
    const s = summarise(data, b)
    return { label: b.label, start: b.start, end: b.end, workedOn: s.workedOn, reached: s.reached, won: s.won }
  })
}

/**
 * One row per salesperson: who tried how many people, reached how many, won and lost what.
 * Activities are credited to whoever logged them; deals to whoever closed them.
 */
export function bySalesperson({ activities, deals }, range) {
  const rows = new Map()
  const row = (uid) => {
    if (!rows.has(uid)) rows.set(uid, { uid, worked: new Set(), reached: new Set(), won: 0, lost: 0 })
    return rows.get(uid)
  }
  for (const a of activities) {
    if (a.isVoided || !inRange(a.dayKey, range) || !a.byUserId) continue
    row(a.byUserId).worked.add(a.leadId)
    if (a.outcome === 'spoke') row(a.byUserId).reached.add(a.leadId)
  }
  for (const d of deals) {
    if (!inRange(d.closedDayKey, range) || !d.closedBy) continue
    if (d.status === 'closed_won') row(d.closedBy).won += 1
    if (d.status === 'closed_lost') row(d.closedBy).lost += 1
  }
  return [...rows.values()]
    .map((r) => ({ uid: r.uid, workedOn: r.worked.size, reached: r.reached.size, won: r.won, lost: r.lost }))
    .sort((a, b) => b.won - a.won || b.workedOn - a.workedOn)
}

/**
 * "Took one, pitch the next": clients who bought at least one product and have not yet
 * taken the others, soonest event first (no event date sorts last). `leadDeals` maps a
 * lead id to ALL of its deals; `leadsById` holds the lead documents.
 */
export function pitchNext(leadDeals, leadsById, now = new Date()) {
  const today = dayKey(now)
  const out = []
  for (const [leadId, deals] of leadDeals) {
    const lead = leadsById.get(leadId)
    if (!lead) continue
    const taken = PRODUCT_TYPES.filter((p) => deals.some((d) => d.productType === p && d.status === 'closed_won'))
    if (!taken.length) continue
    const inProgress = PRODUCT_TYPES.filter((p) => deals.some((d) => d.productType === p && d.status === 'open'))
    const declined = PRODUCT_TYPES.filter((p) => !taken.includes(p) && deals.some((d) => d.productType === p && d.status === 'closed_lost'))
    const notYet = PRODUCT_TYPES.filter((p) => p !== 'other' && !taken.includes(p) && !declined.includes(p))
    if (!notYet.length) continue
    const eventDay = lead.eventDate ? dayKey(lead.eventDate) : null
    if (eventDay && eventDay < today) continue // the event is over — nothing left to sell
    out.push({ lead, taken, inProgress, notYet, eventDay })
  }
  return out.sort((a, b) => {
    if (a.eventDay && b.eventDay) return a.eventDay.localeCompare(b.eventDay)
    if (a.eventDay) return -1
    if (b.eventDay) return 1
    return 0
  })
}

/** Signed change for the ▲▼ badges. */
export function delta(current, previous) {
  return current - previous
}

/* ----------------------------------------------------------- speed to first contact */

/**
 * For leads ADDED in `range`: how many have had a first contact, and the average time it
 * took. Every attempt counts — a call nobody answered is still a first contact — and a
 * voided entry does not. Leads still waiting are left out of the average (they appear in
 * waitingForFirstContact instead), so the number cannot be dragged down by leads that
 * simply have not been worked yet.
 */
export function firstContactStats({ activities, leads }, range) {
  const firstAt = new Map()
  for (const a of activities) {
    if (a.isVoided) continue
    const at = toDate(a.at)
    if (!at) continue
    const prev = firstAt.get(a.leadId)
    if (!prev || at < prev) firstAt.set(a.leadId, at)
  }

  let contacted = 0
  let totalMs = 0
  for (const lead of leads) {
    if (!inRange(lead.dayKey, range)) continue
    const created = toDate(lead.createdAt)
    const first = firstAt.get(lead.id)
    if (!created || !first) continue
    contacted += 1
    totalMs += Math.max(0, first.getTime() - created.getTime())
  }
  return { contacted, avgMs: contacted ? totalMs / contacted : null }
}

/**
 * Right now: leads nobody has contacted yet that are due (New), and those that have gone
 * past the 24-hour window. Leads scheduled for later are not waiting yet.
 */
export function waitingForFirstContact(neverContactedLeads, now = new Date()) {
  let waiting = 0
  let pastWindow = 0
  for (const lead of neverContactedLeads) {
    const bucket = leadBucket(lead, now)
    if (bucket === 'new') waiting += 1
    if (bucket === 'overdue') { waiting += 1; pastWindow += 1 }
  }
  return { waiting, pastWindow }
}
