// Pure SMS helpers (no Firebase): phone numbers, quiet hours, and which drafts a record change creates.
// Kept free of I/O so they can be unit tested with `npm test`.

const HOUR = 3600000
export const DRAFT_TTL = 24 * HOUR
const EAT = 3 * HOUR // Tanzania is UTC+3 all year (no daylight saving).
export const QUIET_START = 20 // 20:00 EAT
export const QUIET_END = 8 // 08:00 EAT

// Tanzanian mobile numbers in the gateway's format: 2557XXXXXXXX / 2556XXXXXXXX. Anything else → null.
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('0')) d = '255' + d.slice(1)
  else if (d.length === 9) d = '255' + d
  return /^255[67]\d{8}$/.test(d) ? d : null
}

export function inQuietHours(now = Date.now()) {
  const h = new Date(now + EAT).getUTCHours()
  return h >= QUIET_START || h < QUIET_END
}

// The next 08:00 in Tanzania after `now`.
export function nextSendWindow(now = Date.now()) {
  const local = new Date(now + EAT)
  local.setUTCHours(QUIET_END, 0, 0, 0)
  let t = local.getTime() - EAT
  if (t <= now) t += 24 * HOUR
  return t
}

const num = (v) => Number(v) || 0

// How the owner is named in an SMS: their first name, keeping a title with it ("Mr Sam", not just "Mr").
const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|eng|bw|bi|sir|madam)\.?$/i
export function ownerCallName(fullName) {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  return TITLES.test(words[0] || '') && words[1] ? `${words[0]} ${words[1]}` : words[0] || ''
}

// Stage → message kind. Only these stages prompt an SMS; every other stage change just retires stale drafts.
export const STAGE_KINDS = { 'Quote Sent': 'quote_sent', 'Client Approval': 'client_approval', Completed: 'completed' }
// Drafts in the same group replace each other: a newer stage makes an older stage message outdated.
export const GROUP = { lead_welcome: 'lead', quote_sent: 'stage', client_approval: 'stage', completed: 'stage', payment_received: 'payment' }

// Decide what a write to a lead/opportunity means for SMS. `before`/`after` are document data or null.
// Returns { outdate: [groups to retire], create: [{ kind, paid? }] }.
export function planSms(objectKey, before, after, now = Date.now()) {
  const plan = { outdate: [], create: [] }
  if (!after) return { outdate: ['lead', 'stage', 'payment'], create: [] } // deleted: nothing pending should go out
  if (after.smsOptOut) return { outdate: ['lead', 'stage', 'payment'], create: [] }

  if (objectKey === 'leads') {
    // Only leads created in HaflaCREM just now; imports (legacy) and old records never prompt.
    const fresh = !after.legacy && num(after.createdAt) > now - HOUR
    if (!before && fresh && !['Converted', 'Unqualified'].includes(after.status)) plan.create.push({ kind: 'lead_welcome' })
    return plan
  }

  if (objectKey === 'opportunities' && before) {
    if (after.stage !== before.stage) {
      plan.outdate.push('stage')
      if (STAGE_KINDS[after.stage]) plan.create.push({ kind: STAGE_KINDS[after.stage] })
    }
    const paid = num(after.amountPaid) - num(before.amountPaid)
    if (paid > 0) {
      plan.outdate.push('payment')
      plan.create.push({ kind: 'payment_received', paid })
    }
  }
  return plan
}
