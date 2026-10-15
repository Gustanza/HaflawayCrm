import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, inQuietHours, nextSendWindow, planSms, ownerCallName } from './sms.js'
import { TEMPLATES } from './templates.js'

const eat = (iso) => Date.parse(iso + '+03:00')

test('normalizePhone accepts the usual Tanzanian formats', () => {
  for (const p of ['0712 345 678', '+255712345678', '255712345678', '712345678', '00255-712-345-678', '0655123456']) {
    assert.match(normalizePhone(p), /^255[67]\d{8}$/, p)
  }
  for (const p of ['', null, '12345', '0222123456', '+254712345678', '07123456789']) assert.equal(normalizePhone(p), null, String(p))
})

test('quiet hours are 20:00–08:00 in Tanzania', () => {
  assert.equal(inQuietHours(eat('2026-10-14T07:59')), true)
  assert.equal(inQuietHours(eat('2026-10-14T08:00')), false)
  assert.equal(inQuietHours(eat('2026-10-14T19:59')), false)
  assert.equal(inQuietHours(eat('2026-10-14T20:00')), true)
  assert.equal(nextSendWindow(eat('2026-10-14T21:30')), eat('2026-10-15T08:00'))
  assert.equal(nextSendWindow(eat('2026-10-14T06:00')), eat('2026-10-14T08:00'))
})

test('a lead created in the app gets a welcome draft; imports and old records do not', () => {
  const now = Date.now()
  assert.deepEqual(planSms('leads', null, { status: 'New', createdAt: now }, now).create, [{ kind: 'lead_welcome' }])
  assert.deepEqual(planSms('leads', null, { status: 'New', createdAt: now, legacy: {} }, now).create, [])
  assert.deepEqual(planSms('leads', null, { status: 'New', createdAt: now - 2 * 3600000 }, now).create, [])
  assert.deepEqual(planSms('leads', { status: 'New' }, { status: 'Working', createdAt: now }, now).create, [])
})

test('job stage changes retire stale drafts and prompt only on key stages', () => {
  const p = planSms('opportunities', { stage: 'Inquiry' }, { stage: 'Quote Sent' })
  assert.deepEqual(p, { outdate: ['stage'], create: [{ kind: 'quote_sent' }] })
  // Moving back (e.g. a Kanban mis-drag) only retires the pending draft.
  assert.deepEqual(planSms('opportunities', { stage: 'Quote Sent' }, { stage: 'Inquiry' }), { outdate: ['stage'], create: [] })
  assert.deepEqual(planSms('opportunities', { stage: 'Design' }, { stage: 'Design', name: 'x' }), { outdate: [], create: [] })
  // New jobs (conversion, imports) never prompt.
  assert.deepEqual(planSms('opportunities', null, { stage: 'Quote Sent' }).create, [])
})

test('a payment increase creates a receipt; opt-out and deletion retire everything', () => {
  const p = planSms('opportunities', { stage: 'Deposit Paid', amountPaid: 100000 }, { stage: 'Deposit Paid', amountPaid: 250000 })
  assert.deepEqual(p.create, [{ kind: 'payment_received', paid: 150000 }])
  assert.deepEqual(planSms('opportunities', { amountPaid: 5 }, { amountPaid: 1 }).create, [])
  assert.deepEqual(planSms('opportunities', { stage: 'A' }, { stage: 'Quote Sent', smsOptOut: true }).create, [])
  assert.deepEqual(planSms('opportunities', { stage: 'A' }, null).outdate, ['lead', 'stage', 'payment'])
})

test('templates fill in values, stay ASCII, and soften funeral messages', () => {
  const v = { name: 'Neema', owner: 'Godwill', service: 'Kadi za Michango', amount: 350000, paid: 100000, balance: 250000 }
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const s = t(v)
    assert.ok(!/undefined|null|NaN/.test(s), `${k}: ${s}`)
    assert.ok(/^[\x20-\x7e]*$/.test(s), `${k} is not plain ASCII: ${s}`)
  }
  assert.match(TEMPLATES.quote_sent(v), /TZS 350,000/)
  assert.match(TEMPLATES.payment_received({ ...v, balance: 0 }), /yamekamilika/)
  assert.doesNotMatch(TEMPLATES.completed({ ...v, eventType: 'Funeral / Msiba' }), /marafiki|Karibu tena/)
  assert.doesNotMatch(TEMPLATES.quote_sent({ name: 'A' }), /undefined/)
})

test('owner name in SMS keeps a title with the name', () => {
  assert.equal(ownerCallName('Mr Sam'), 'Mr Sam')
  assert.equal(ownerCallName('Dr. Neema Juma'), 'Dr. Neema')
  assert.equal(ownerCallName('Godwill Stanley Sam'), 'Godwill')
  assert.equal(ownerCallName('Mr'), 'Mr')
  assert.equal(ownerCallName(''), '')
})
