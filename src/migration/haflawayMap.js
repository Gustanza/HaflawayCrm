// Pure mapping from Haflaway CRM data to HaflaCREM records (no Firebase imports, so the
// browser import page and the command-line migration share exactly the same rules).
//
// SAFETY: this module only READS the old app's collections (leads + their deals/activities/payments
// subcollections, usersPublic/users for names). Every write goes to HaflaCREM's own `crm_*`
// collections (enforced in runImport). The old app's data is never modified or deleted, so it keeps
// working exactly as before.
//
// Re-running is safe: imported documents get deterministic IDs derived from the old IDs, and records
// that already exist in HaflaCREM are skipped unless "overwrite" is chosen.

import { WON_STAGE, LOST_STAGE, stageProbability } from '../meta/objects.js'

const TZ = 'Africa/Dar_es_Salaam'
const APP = 'haflawaycrm'

// ---------------------------------------------------------------- old value → HaflaCREM value
const SOURCE = {
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', referral: 'Referral',
  repeat_customer: 'Repeat Customer', agent_partner: 'Agent / Partner', walk_in: 'Walk-in',
  committee_visit: 'Event / Kikao', other: 'Other',
}
const EVENT = {
  harusi: 'Wedding', send_off: 'Send-off', kitchen_party: 'Kitchen Party', birthday: 'Birthday',
  mahafali: 'Graduation', msiba: 'Funeral / Msiba', kumbukumbu: 'Memorial', corporate: 'Corporate', other: 'Other',
}
// Used to name the Account after the event, e.g. "Harusi ya Neema Joseph".
const EVENT_SW = {
  harusi: 'Harusi', send_off: 'Send-off', kitchen_party: 'Kitchen Party', birthday: 'Birthday',
  mahafali: 'Mahafali', msiba: 'Msiba', kumbukumbu: 'Kumbukumbu',
}
const PRODUCT = {
  contribution_card: 'Kadi za Michango', contribution_reminder: 'SMS Reminder za Michango',
  committee_invite: 'Kadi za Mwaliko wa Kamati', invitation_card: 'Invitation Card',
  rsvp_checkin: 'Invitation + RSVP / QR Check-in', full_package: 'Full Package (Michango + Invitations)',
  thank_you: 'Thank You Message', other: 'Other',
}
const REGION = {
  dar_es_salaam: 'Dar es Salaam', arusha: 'Arusha', mwanza: 'Mwanza', dodoma: 'Dodoma', mbeya: 'Mbeya',
  morogoro: 'Morogoro', zanzibar: 'Zanzibar', tanga: 'Tanga', kilimanjaro: 'Moshi / Kilimanjaro', other_region: 'Other Region',
}
// Old won deals track delivery separately; HaflaCREM folds delivery into the job stages.
const DELIVERY_STAGE = { brief: 'Deposit Paid', design: 'Design', approval: 'Client Approval', sending: 'Sending', done: WON_STAGE }
const CHANNEL = { call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', in_person: 'In person', other: 'Other' }
const OUTCOME = {
  spoke: 'Spoke', no_answer: 'No answer', busy: 'Busy', switched_off: 'Switched off',
  wrong_number: 'Wrong number', callback_requested: 'Callback requested',
}
const NOT_QUALIFIED = {
  browsing: 'Just asking prices / browsing', budget_too_low: 'Budget too low', too_few_guests: 'Too few guests',
  event_too_far: 'Event date too far away', event_passed: 'Event already passed / too soon',
  outside_area: 'Outside our service area', printed_only: 'Wants printed cards only',
  other_service: 'Wants another service (venue, MC, decor...)', has_provider: 'Already has a provider',
  no_response: 'Never replied (no response)', wrong_number: 'Wrong number / spam', other: 'Other',
}
const LOST = {
  price: 'Price too high (bei kubwa)', chose_competitor: 'Chose a competitor', did_it_themselves: 'Did it themselves',
  event_cancelled: 'Event cancelled or postponed', no_budget: 'No budget', no_response: 'No response',
  wrong_fit: 'Wrong fit', other: 'Other', chose_printed: 'Chose printed cards',
  committee_decided: 'Committee / family decided against', distrust_digital: "Doesn't trust digital cards",
  stopped_replying: 'Stopped replying after quote',
}
const PAYMENT_METHOD = {
  mpesa: 'M-Pesa', tigo_pesa: 'Mixx by Yas (Tigo Pesa)', airtel_money: 'Airtel Money', bank: 'Bank transfer', cash: 'Cash', other: 'Other',
}
const OLD_STATUS_LABEL = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', quote_sent: 'Quote sent', negotiating: 'Negotiating',
  customer: 'Customer', deposit_paid: 'Deposit paid', paid_in_full: 'Paid in full', not_qualified: 'Not qualified',
  no_response: 'No response', lost: 'Lost',
}

// ---------------------------------------------------------------- helpers
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6)
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}
// Calendar date in Tanzania time: event dates were saved as 12:00 EAT, so this never shifts a day.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
export function dayInTz(v) {
  const ms = toMs(v)
  return ms === null ? null : dayFmt.format(new Date(ms))
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
const money = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
const tzs = (n) => 'TZS ' + Math.round(n).toLocaleString('en-US')

export function splitName(displayName) {
  const clean = String(displayName || '').trim().replace(/\s+/g, ' ')
  if (!clean) return { firstName: '', lastName: 'Mteja mpya' }
  // Couples and families ("Neema & Baraka", "Familia ya Mushi") stay whole rather than being split.
  if (/&|\+|\/|\b(na|and|ya|wa|family|familia)\b/i.test(clean)) return { firstName: '', lastName: clean }
  const parts = clean.split(' ')
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

// Same rules as the old app's domain/leadStatus.js, so "status there" matches what users saw.
export function oldLeadStatus(lead, deals = []) {
  if (lead?.disqualifiedReason) return lead.disqualifiedReason === 'no_response' ? 'no_response' : 'not_qualified'
  const won = deals.filter((d) => d.status === 'closed_won')
  const open = deals.filter((d) => d.status === 'open')
  const hasQuote = (d) => money(d?.amount) > 0
  if (won.length) {
    if (open.length) return 'customer'
    const owed = won.reduce((s, d) => s + Math.max(0, money(d.amount) - money(d.paidAmount)), 0)
    const paid = won.reduce((s, d) => s + money(d.paidAmount), 0)
    return won.every(hasQuote) && paid > 0 && owed === 0 ? 'paid_in_full' : 'deposit_paid'
  }
  if (deals.length && !open.length) return 'lost'
  if (open.some((d) => d.negotiating)) return 'negotiating'
  if (open.some(hasQuote)) return 'quote_sent'
  if (lead?.qualifiedAt) return 'qualified'
  if (lead?.firstContactedAt) return 'contacted'
  return 'new'
}

function oppStage(deal, eventDate, today) {
  if (deal.status === 'closed_lost') return LOST_STAGE
  if (deal.status === 'closed_won') {
    if (DELIVERY_STAGE[deal.deliveryStage]) return DELIVERY_STAGE[deal.deliveryStage]
    // Old rule: a won sale with no delivery stage whose event already passed was delivered.
    return eventDate && eventDate < today ? WON_STAGE : 'Deposit Paid'
  }
  return money(deal.amount) > 0 || deal.negotiating ? 'Quote Sent' : 'Inquiry'
}

// Firestore values → plain JSON for the backup file.
export function plain(v) {
  if (v === null || v === undefined) return v ?? null
  if (typeof v.toDate === 'function') return v.toDate().toISOString()
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(plain)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  return v
}

export async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n) }
  }))
  return out
}

export function backupJson(data) {
  return JSON.stringify(plain({ source: APP, ...data }), null, 2)
}

// ---------------------------------------------------------------- 2. map (pure)
export function buildPlan(data, { today = dayFmt.format(new Date()) } = {}) {
  const writes = []
  const warnings = []
  const preview = []
  const stats = { leads: 0, skippedDeleted: 0, deals: 0, activities: 0, voidedActivities: 0, payments: 0, voidedPayments: 0, orgs: new Set() }
  const add = (col, id, d) => writes.push({ col, id, data: d })
  const nameOf = (uid, fallback) => data.names[uid] || fallback || 'Imported user'

  for (const L of data.leads) {
    if (L.deletedAt) { stats.skippedDeleted++; continue }
    stats.leads++
    stats.orgs.add(L.orgId)
    const deals = L.deals || []
    const status = oldLeadStatus(L, deals)
    const converted = deals.length > 0
    const { firstName, lastName } = splitName(L.displayName)
    const displayName = (L.displayName || '').trim() || 'Mteja mpya'
    const eventDate = dayInTz(L.eventDate)
    const created = toMs(L.createdAt) || toMs(L.updatedAt) || Date.now()
    const updated = toMs(L.updatedAt) || created
    const owner = { ownerId: L.ownerId || null, ownerName: nameOf(L.ownerId) }
    const legacy = { app: APP, leadId: L.id, orgId: L.orgId, status }
    const eventType = EVENT[L.eventType] || null
    const source = SOURCE[L.source] || (L.source ? 'Other' : null)
    const region = REGION[L.location] || null
    if (L.eventType && !EVENT[L.eventType]) warnings.push(`${displayName}: unknown event type "${L.eventType}" (saved in description).`)

    const notes = [`Imported from Haflaway CRM. Status there: ${OLD_STATUS_LABEL[status] || status}.`]
    if (L.disqualifiedReason) notes.push(`Not qualified because: ${NOT_QUALIFIED[L.disqualifiedReason] || L.disqualifiedReason}.`)
    if (L.adName) notes.push(`Ad: ${L.adName}`)
    if (L.referredBy) notes.push(`Referred by: ${typeof L.referredBy === 'string' ? L.referredBy : JSON.stringify(plain(L.referredBy))}`)
    if (money(L.estimatedValue)) notes.push(`Estimated value: ${tzs(L.estimatedValue)}`)
    if (eventDate && L.eventDateIsFirm === false) notes.push('Event date was not confirmed.')
    if (L.eventType && !EVENT[L.eventType]) notes.push(`Event type: ${L.eventType}`)
    if (L.altPhones?.length) notes.push(`Other phones: ${L.altPhones.join(', ')}`)
    if (L.location && !REGION[L.location]) notes.push(`Location: ${L.location}`)

    const firstService = PRODUCT[deals[0]?.productType] || null
    const lead = {
      firstName, lastName, company: displayName, title: null, email: L.email || null, phone: L.primaryPhone || null,
      status: converted ? 'Converted' : status === 'not_qualified' || status === 'no_response' ? 'Unqualified' : status === 'new' ? 'New' : 'Working',
      source, rating: L.isHot ? 'Hot' : null, eventType, eventDate, service: firstService, guests: null, region,
      description: notes.join('\n'), ...owner, createdAt: created, updatedAt: updated, legacy,
    }

    // Activities attach to the contact once a lead is converted (so they roll up to the account).
    const target = converted
      ? { relatedType: 'contacts', relatedId: L.id, accountId: L.id }
      : { relatedType: 'leads', relatedId: L.id, accountId: null }

    let won = 0, owed = 0
    const services = []
    if (converted) {
      const firstDealAt = Math.min(...deals.map((d) => toMs(d.createdAt) || updated))
      Object.assign(lead, {
        convertedAt: firstDealAt, convertedAccountId: L.id, convertedContactId: L.id, convertedOpportunityId: deals[0].id,
      })
      const anyWon = deals.some((d) => d.status === 'closed_won')
      add('accounts', L.id, {
        name: EVENT_SW[L.eventType] ? `${EVENT_SW[L.eventType]} ya ${displayName}` : displayName,
        type: anyWon ? 'Customer' : 'Prospect', eventType, eventDate, region, phone: L.primaryPhone || null,
        description: `Imported from Haflaway CRM.`, ...owner, createdAt: created, updatedAt: updated, legacy,
      })
      add('contacts', L.id, {
        firstName, lastName, accountId: L.id, title: null, email: L.email || null, phone: L.primaryPhone || null,
        source, ...owner, createdAt: created, updatedAt: updated, legacy,
      })

      for (const d of deals) {
        stats.deals++
        const service = PRODUCT[d.productType] || 'Other'
        if (!PRODUCT[d.productType]) warnings.push(`${displayName}: unknown product "${d.productType}" imported as Other.`)
        const stage = oppStage(d, eventDate, today)
        const amount = money(d.amount) || null
        const dealPayments = (L.payments || []).filter((p) => p.dealId === d.id && !p.isVoided)
        const paymentsSum = dealPayments.reduce((s, p) => s + money(p.amount), 0)
        const amountPaid = money(d.paidAmount)
        if (Math.round(paymentsSum) !== Math.round(amountPaid)) {
          warnings.push(`${displayName} · ${service}: paid amount ${tzs(amountPaid)} differs from payment records ${tzs(paymentsSum)}; used ${tzs(amountPaid)} as the old app shows.`)
        }
        const dealCreated = toMs(d.createdAt) || created
        const closeDate = eventDate ? addDays(eventDate, -7) : dayInTz(d.closedAt) || dayInTz(dealCreated)
        const completedDate = stage === WON_STAGE ? dayInTz(d.deliveryStageAt) || (eventDate && eventDate < today ? eventDate : null) || dayInTz(d.closedAt) : null
        const extra = []
        if (d.negotiating) extra.push('Was marked "negotiating" in Haflaway CRM.')
        if (d.status === 'closed_won' && !d.deliveryStage) extra.push('Delivery stage was not set in Haflaway CRM.')
        add('opportunities', d.id, {
          name: `${displayName} - ${service}`, accountId: L.id, contactId: L.id, service, eventType, eventDate, guests: null,
          amount, amountPaid, balance: (amount || 0) - amountPaid, closeDate, stage, probability: stageProbability(stage),
          completedDate, source, lostReason: d.status === 'closed_lost' ? LOST[d.lostReason] || d.lostReason || null : null,
          nextStep: null, description: extra.join('\n') || null,
          ...owner, createdAt: dealCreated, updatedAt: toMs(d.updatedAt) || dealCreated,
          legacy: { app: APP, leadId: L.id, dealId: d.id, status: d.status, deliveryStage: d.deliveryStage || null },
        })
        services.push(`${service} → ${stage}`)
        if (d.status === 'closed_won') { won += amount || 0; owed += Math.max(0, (amount || 0) - amountPaid) }
      }
    }
    add('leads', L.id, lead)

    for (const a of L.activities || []) {
      if (a.isVoided) { stats.voidedActivities++; continue }
      stats.activities++
      const rel = a.dealId && deals.some((d) => d.id === a.dealId)
        ? { relatedType: 'opportunities', relatedId: a.dealId, accountId: target.accountId }
        : target
      add('activities', `${L.id}_${a.id}`, {
        type: a.channel === 'call' ? 'call' : 'note',
        subject: [CHANNEL[a.channel] || a.channel || 'Activity', OUTCOME[a.outcome]].filter(Boolean).join(' – '),
        body: a.summary || '', ...rel,
        ownerId: a.byUserId || owner.ownerId, ownerName: a.byUserName || nameOf(a.byUserId, owner.ownerName),
        createdAt: toMs(a.at) || toMs(a.createdAt) || updated,
        legacy: { app: APP, leadId: L.id, activityId: a.id },
      })
    }
    for (const p of L.payments || []) {
      if (p.isVoided) { stats.voidedPayments++; continue }
      stats.payments++
      const method = PAYMENT_METHOD[p.method] || p.method
      add('activities', `pay_${p.id}`, {
        type: 'note',
        subject: `Payment received: ${tzs(money(p.amount))}${method ? ` (${method})` : ''}`,
        body: [p.note, `Paid on ${dayInTz(p.at) || 'unknown date'}.`].filter(Boolean).join('\n'),
        relatedType: 'opportunities', relatedId: p.dealId, accountId: target.accountId,
        ownerId: p.byUserId || owner.ownerId, ownerName: p.byUserName || nameOf(p.byUserId, owner.ownerName),
        createdAt: toMs(p.at) || toMs(p.createdAt) || updated,
        legacy: { app: APP, leadId: L.id, paymentId: p.id, dealId: p.dealId },
      })
    }
    add('activities', `imp_${L.id}`, {
      type: 'system', subject: `Imported from Haflaway CRM (status there: ${OLD_STATUS_LABEL[status] || status})`, body: '',
      ...target, ...owner, createdAt: updated, legacy: { app: APP, leadId: L.id },
    })

    // Open follow-up → a HaflaCREM task, so nothing falls through the cracks.
    const follow = dayInTz(L.nextFollowUpAt)
    if (follow && status !== 'not_qualified' && status !== 'no_response' && status !== 'lost') {
      add('tasks', `fu_${L.id}`, {
        subject: `Follow up${L.nextFollowUpType ? ` (${CHANNEL[L.nextFollowUpType] || L.nextFollowUpType})` : ''}: ${displayName}`,
        dueDate: follow, status: 'Not Started', priority: L.isHot ? 'High' : 'Normal',
        relatedType: target.relatedType, relatedId: target.relatedId, accountId: target.accountId,
        description: L.lastActivitySummary ? `Last contact: ${L.lastActivitySummary}` : null,
        ...owner, createdAt: updated, updatedAt: updated, legacy: { app: APP, leadId: L.id },
      })
    }

    preview.push({
      id: L.id, name: displayName, phone: L.primaryPhone || '', eventType, eventDate,
      oldStatus: OLD_STATUS_LABEL[status] || status, newStatus: lead.status, services, won, owed,
    })
  }

  // HaflaCREM's own records from before the move: copied as they are.
  for (const [c, rows] of Object.entries(data.preMove || {})) {
    for (const r of rows) {
      const { id, ...rest } = r
      add(c, id, Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v && typeof v.toMillis === 'function' ? v.toMillis() : v])))
    }
  }
  if (data.unknownLeads?.length) warnings.push(`${data.unknownLeads.length} document(s) in "leads" belong to neither app and were left alone.`)
  if (stats.orgs.size > 1) warnings.push(`Leads come from ${stats.orgs.size} different organisations in Haflaway CRM; all were imported.`)
  if (stats.skippedDeleted) warnings.push(`${stats.skippedDeleted} lead(s) were deleted in Haflaway CRM and were not imported.`)

  const counts = {}
  for (const w of writes) counts[w.col] = (counts[w.col] || 0) + 1
  return { writes, counts, warnings, preview, stats: { ...stats, orgs: stats.orgs.size } }
}

