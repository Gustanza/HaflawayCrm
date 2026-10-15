// HaflaCREM Cloud Functions — SMS to leads and clients through the SMTZ gateway.
//
// Nothing is ever sent automatically. A change to a lead or job creates an SMS *draft* in `crm_sms`;
// the record's owner (or an admin) then presses Send (optionally editing the text or number) or Cancel in the app.
//
//   draft lifecycle: pending → sending → sent
//                            ↘ scheduled (approved during quiet hours) → sending → sent
//                    pending → cancelled | expired (24h) | outdated (record moved on before it was sent)
//                    sending → failed → (Retry) sending ...
//
// Delivery reports are not wired yet; `campaignId` and `deliveryStatus` are stored so they can be.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret, defineString, defineBoolean } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { planSms, normalizePhone, inQuietHours, nextSendWindow, ownerCallName, GROUP, DRAFT_TTL } from './sms.js'
import { TEMPLATES, LABELS } from './templates.js'
import { roleOf } from './users.js'

export { adminCreateUser, adminUpdateUser, adminSetPassword, adminReassign } from './users.js'

// Must match the Firestore database location, and FUNCTIONS_REGION in ../fireCreds.js.
const REGION = 'us-central1'

const SMTZ_API_KEY = defineSecret('SMTZ_API_KEY')
const SMTZ_SENDER_ID = defineString('SMTZ_SENDER_ID', { description: 'Approved SMTZ sender ID (max 11 characters), e.g. HAFLAWAY' })
const SMTZ_BASE_URL = defineString('SMTZ_BASE_URL', { default: 'https://messaging-api.haflaway.com/api/v1' })
const SMS_STAFF_EMAILS = defineString('SMS_STAFF_EMAILS', {
  description: 'Comma-separated emails of staff allowed to send SMS (admins always can)',
})
const SMS_PAYMENT_INFO = defineString('SMS_PAYMENT_INFO', { default: '', description: 'Optional payment line added to quote SMS, e.g. "Lipa Namba: 123456 (Haflaway)."' })
const SMS_DRY_RUN = defineBoolean('SMS_DRY_RUN', { default: false, description: 'true = never call SMTZ; pretend messages were sent (for the emulator)' })

initializeApp()
const db = getFirestore()
setGlobalOptions({ region: REGION, maxInstances: 10 })

const SMS = 'crm_sms'
const OPEN = ['pending', 'failed', 'scheduled']

/* ---------------- Drafts from record changes ---------------- */

export const smsOnLead = onDocumentWritten('crm_leads/{id}', (e) => onRecordWrite('leads', e))
export const smsOnOpportunity = onDocumentWritten('crm_opportunities/{id}', (e) => onRecordWrite('opportunities', e))

async function onRecordWrite(objectKey, event) {
  const before = event.data.before.exists ? event.data.before.data() : null
  const after = event.data.after.exists ? event.data.after.data() : null
  const id = event.params.id
  const plan = planSms(objectKey, before, after)
  if (!plan.outdate.length && !plan.create.length) return

  // Retire drafts the record has moved past (including moving a job back a stage after a mis-drag).
  let carriedPaid = 0
  if (plan.outdate.length) {
    const open = await db.collection(SMS).where('relatedId', '==', id).where('status', '==', 'pending').get()
    const batch = db.batch()
    for (const d of open.docs) {
      if (!plan.outdate.includes(d.get('group'))) continue
      if (d.get('group') === 'payment') carriedPaid += Number(d.get('meta.paid')) || 0 // one receipt covers both payments
      batch.update(d.ref, { status: 'outdated', updatedAt: Date.now() })
    }
    await batch.commit()
  }
  if (!plan.create.length || !after.ownerId) return // no owner → nobody could approve it

  const to = await recipientOf(objectKey, after)
  const vars = {
    name: to.name, owner: ownerCallName(after.ownerName), service: after.service, eventType: after.eventType,
    amount: after.amount, balance: after.balance, payment: SMS_PAYMENT_INFO.value(),
  }
  const now = Date.now()
  for (const c of plan.create) {
    const paid = c.kind === 'payment_received' ? c.paid + carriedPaid : undefined
    const phone = normalizePhone(to.phone)
    const draft = {
      kind: c.kind, group: GROUP[c.kind], label: LABELS[c.kind],
      relatedType: objectKey, relatedId: id, recordName: recordName(objectKey, after),
      accountId: objectKey === 'leads' ? null : after.accountId || null,
      ownerId: after.ownerId, ownerName: after.ownerName || '',
      recipientName: to.name, phone: phone || to.phone || '', phoneValid: !!phone,
      content: TEMPLATES[c.kind]({ ...vars, paid }),
      meta: paid ? { paid } : {},
      status: 'pending', attempts: 0, createdAt: now, updatedAt: now, expiresAt: now + DRAFT_TTL,
      campaignId: null, deliveryStatus: null,
    }
    // Triggers can fire more than once for the same change; the event id makes the draft id idempotent.
    await db.collection(SMS).doc(`${event.id}-${c.kind}`).create(draft).catch((err) => {
      if (err.code !== 6) throw err // 6 = ALREADY_EXISTS
    })
  }
}

// Who the SMS goes to: the lead itself, or the job's primary contact (mobile first), falling back to the account.
async function recipientOf(objectKey, r) {
  if (objectKey === 'leads') return { name: r.firstName || r.lastName || '', phone: r.phone }
  const contact = r.contactId ? (await db.doc(`crm_contacts/${r.contactId}`).get()).data() : null
  const account = r.accountId ? (await db.doc(`crm_accounts/${r.accountId}`).get()).data() : null
  return {
    name: contact?.firstName || contact?.lastName || account?.name || '',
    phone: contact?.mobile || contact?.phone || account?.phone || '',
  }
}

const recordName = (objectKey, r) =>
  objectKey === 'leads' ? [r.firstName, r.lastName].filter(Boolean).join(' ') || r.company || '' : r.name || ''

/* ---------------- Staff actions ---------------- */

// Admins can act on anyone's drafts; reps only on their own, and only if listed in SMS_STAFF_EMAILS.
async function requireStaff(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  const email = String(req.auth.token.email || '').toLowerCase()
  const role = await roleOf(req.auth)
  if (!role) throw new HttpsError('permission-denied', 'Your HaflaCREM access is not active. Ask an admin.')
  const allowed = SMS_STAFF_EMAILS.value().split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (role !== 'admin' && !allowed.includes(email)) {
    throw new HttpsError('permission-denied', `${email || 'This account'} is not allowed to send SMS. Ask an admin to add it to SMS_STAFF_EMAILS.`)
  }
  // `admin` stays out of the stored approvedBy/cancelledBy fields.
  return [{ uid: req.auth.uid, name: req.auth.token.name || email.split('@')[0] }, role === 'admin']
}

// Load a draft the caller owns (or any draft, for an admin), inside a transaction.
async function ownDraft(tx, ref, user, admin) {
  const snap = await tx.get(ref)
  if (!snap.exists) throw new HttpsError('not-found', 'This SMS no longer exists.')
  const d = snap.data()
  if (d.ownerId !== user.uid && !admin) throw new HttpsError('permission-denied', `Only ${d.ownerName || 'the record owner'} can act on this SMS.`)
  return d
}

// data: { id, content, phone, when?: 'now' | 'schedule' }. Outside 08:00–20:00 EAT the caller must choose `when`.
export const smsSend = onCall({ secrets: [SMTZ_API_KEY] }, async (req) => {
  const [user, admin] = await requireStaff(req)
  const { id, when } = req.data || {}
  const content = String(req.data?.content ?? '').trim()
  const phone = normalizePhone(req.data?.phone)
  if (!id) throw new HttpsError('invalid-argument', 'Missing SMS id.')
  if (!content) throw new HttpsError('invalid-argument', 'The message is empty.')
  if (content.length > 1600) throw new HttpsError('invalid-argument', 'The message is too long (1600 characters max).')
  if (!phone) throw new HttpsError('invalid-argument', 'Enter a valid Tanzanian mobile number, e.g. 0712 345 678.')

  const ref = db.collection(SMS).doc(id)
  const now = Date.now()
  const claimed = await db.runTransaction(async (tx) => {
    const d = await ownDraft(tx, ref, user, admin)
    if (!['pending', 'failed'].includes(d.status)) throw new HttpsError('failed-precondition', `This SMS is already ${d.status}.`)
    if (d.status === 'pending' && d.expiresAt <= now) throw new HttpsError('failed-precondition', 'This SMS expired (drafts last 24 hours).')
    if (!when && inQuietHours(now)) {
      throw new HttpsError('failed-precondition', 'It is outside sending hours (08:00–20:00).', { reason: 'quiet-hours', next: nextSendWindow(now) })
    }
    const approval = {
      sentContent: content, sentPhone: phone, phoneEdited: phone !== d.phone, contentEdited: content !== d.content,
      approvedBy: user, approvedAt: now, updatedAt: now, error: null,
    }
    if (when === 'schedule') {
      const scheduledFor = nextSendWindow(now)
      tx.update(ref, { ...approval, status: 'scheduled', scheduledFor, approvalSig: approvalSig(id, phone, content, scheduledFor) })
      return null
    }
    tx.update(ref, { ...approval, status: 'sending', sendingAt: now })
    return { ...d, ...approval }
  })
  if (!claimed) return { status: 'scheduled', scheduledFor: nextSendWindow(now) }
  return deliver(ref, claimed)
})

export const smsCancel = onCall(async (req) => {
  const [user, admin] = await requireStaff(req)
  const ref = db.collection(SMS).doc(String(req.data?.id || ''))
  await db.runTransaction(async (tx) => {
    const d = await ownDraft(tx, ref, user, admin)
    if (!OPEN.includes(d.status)) throw new HttpsError('failed-precondition', `This SMS is already ${d.status}.`)
    tx.update(ref, { status: 'cancelled', cancelledBy: user, updatedAt: Date.now() })
  })
  return { status: 'cancelled' }
})

/* ---------------- Sending ---------------- */

// Scheduled sends run later without a signed-in user, so the approval is signed with a server-only secret.
// The 08:00 job only sends drafts whose text, number and time match what the owner approved, which keeps a
// forged or altered `crm_sms` document from being sent even where Firestore rules allow client writes.
function approvalSig(id, phone, content, scheduledFor) {
  return createHmac('sha256', SMTZ_API_KEY.value()).update(JSON.stringify([id, phone, content, scheduledFor])).digest('hex')
}
function validApproval(id, d) {
  const want = Buffer.from(approvalSig(id, d.sentPhone, d.sentContent, d.scheduledFor))
  const got = Buffer.from(String(d.approvalSig || ''))
  return got.length === want.length && timingSafeEqual(got, want)
}

async function deliver(ref, d) {
  const attempt = d.attempts || 0
  try {
    const campaign = await submitCampaign({
      name: `CRM ${d.label}: ${d.recordName}`.slice(0, 100),
      content: d.sentContent,
      recipients: [d.sentPhone],
      // Same key on a retry after a network timeout → SMTZ returns the original campaign instead of sending twice.
      idempotencyKey: `${ref.id}-${attempt}`,
    })
    const now = Date.now()
    await ref.update({ status: 'sent', sentAt: now, campaignId: campaign.id, providerStatus: campaign.status, updatedAt: now })
    await db.collection('crm_activities').add({
      type: 'sms', subject: `SMS sent: ${d.label}`, body: `${d.sentContent}\n\nTo +${d.sentPhone}`,
      relatedType: d.relatedType, relatedId: d.relatedId, accountId: d.accountId || null,
      // Activity belongs to the record's owner (so they see it); byId/byName say who sent it.
      ownerId: d.ownerId, ownerName: d.ownerName, byId: d.approvedBy.uid, byName: d.approvedBy.name, smsId: ref.id, createdAt: now,
    })
    return { status: 'sent' }
  } catch (err) {
    logger.error('SMS send failed', { id: ref.id, error: err.message })
    // Only move to a new idempotency key once SMTZ has definitely answered with an error.
    await ref.update({ status: 'failed', error: err.message, attempts: err.answered ? attempt + 1 : attempt, updatedAt: Date.now() })
    throw new HttpsError('unavailable', `SMS not sent: ${err.message}`)
  }
}

async function submitCampaign({ name, content, recipients, idempotencyKey }) {
  if (SMS_DRY_RUN.value()) {
    logger.info('[dry run] SMS not sent', { recipients, content })
    return { id: `dryrun-${idempotencyKey}`, status: 'pending' }
  }
  let res
  try {
    res = await fetch(`${SMTZ_BASE_URL.value()}/campaigns`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMTZ_API_KEY.value()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ name, senderId: SMTZ_SENDER_ID.value(), content, recipients }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    throw new Error(`Could not reach SMTZ (${err.name === 'TimeoutError' ? 'timed out' : err.message})`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.message || body.error || `SMTZ returned HTTP ${res.status}`)
    err.answered = true
    throw err
  }
  return body
}

/* ---------------- Housekeeping ---------------- */

// Every 15 minutes: expire old drafts, send approved messages whose 08:00 slot arrived, and surface stuck sends.
export const smsHousekeeping = onSchedule({ schedule: 'every 15 minutes', secrets: [SMTZ_API_KEY] }, async () => {
  const now = Date.now()
  const [pending, scheduled, sending] = await Promise.all(
    ['pending', 'scheduled', 'sending'].map((s) => db.collection(SMS).where('status', '==', s).get()),
  )

  const batch = db.batch()
  for (const d of pending.docs) if (d.get('expiresAt') <= now) batch.update(d.ref, { status: 'expired', updatedAt: now })
  // A send that never finished (function crashed mid-request). Retrying reuses the same idempotency key.
  for (const d of sending.docs) {
    if (d.get('sendingAt') < now - 10 * 60000) batch.update(d.ref, { status: 'failed', error: 'Sending was interrupted. Press Retry.', updatedAt: now })
  }
  await batch.commit()

  for (const d of scheduled.docs) {
    if (d.get('scheduledFor') > now) continue
    if (!validApproval(d.id, d.data())) {
      logger.warn('Scheduled SMS has no valid approval; not sending', { id: d.id })
      await d.ref.update({ status: 'failed', error: 'Approval could not be verified. Review the message and send it again.', updatedAt: now })
      continue
    }
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref)
      if (snap.get('status') !== 'scheduled') return null
      tx.update(d.ref, { status: 'sending', sendingAt: now, updatedAt: now })
      return snap.data()
    })
    if (claimed) await deliver(d.ref, claimed).catch(() => {}) // failure is recorded on the draft
  }
})
