import { CURRENCY, LOCALE } from './meta/objects.js'

export function money(v, compact = false) {
  if (v === null || v === undefined || v === '') return ''
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency', currency: CURRENCY,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(Number(v))
}

export function date(v) {
  if (!v) return ''
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dateTime(ms) {
  if (!ms || isNaN(new Date(ms))) return ''
  return new Date(ms).toLocaleString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function timeAgo(ms) {
  if (!ms) return ''
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return date(ms)
}

// Local calendar dates as 'YYYY-MM-DD' (never via toISOString, which is UTC and is a day behind
// in Tanzania between 00:00 and 03:00).
export const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayISO = () => isoOf(new Date())
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  return isoOf(new Date(y, m - 1, d + n))
}

// '08:00' → '8:00 AM'
export function time(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })
}

// When a task is due, for people: "Today, 8:00 AM", "Tomorrow", "Yesterday, 9:00 AM", "Oct 20, 2026, 9:00 AM".
export function dueLabel(t) {
  if (!t?.dueDate) return ''
  const today = todayISO()
  const day = t.dueDate === today ? 'Today'
    : t.dueDate === addDaysISO(today, 1) ? 'Tomorrow'
    : t.dueDate === addDaysISO(today, -1) ? 'Yesterday'
    : date(t.dueDate)
  return t.dueTime ? `${day}, ${time(t.dueTime)}` : day
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'
}
