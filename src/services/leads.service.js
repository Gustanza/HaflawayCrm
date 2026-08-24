/**
 * Lead persistence.
 *
 * The important function here is `createLead`. Everything else is bookkeeping around it.
 *
 * TODO.md §6.4 — why the phone lock exists: the same bride WhatsApps three different
 * Haflaway staff. Without a lock you get three lead records, three follow-up cadences
 * pestering one customer, and a three-way commission fight when she finally books. The lock
 * is a transaction on `leadPhoneIndex/{phoneNormalized}`, so exactly one create wins even
 * when two agents submit at the same instant.
 */

import {
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  arrayUnion,
} from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { normalizePhone } from '@/domain/phone.js'
import { periodKeys } from '@/domain/periods.js'
import { leadStatusFor, validateTransition } from '@/domain/stages.js'
import { urgencyScore, qualificationScore, priorityScore } from '@/domain/scoring.js'

/**
 * The `leadPhoneIndex` document ID.
 *
 * Org-prefixed, because keying on the bare phone number made the collection a GLOBAL
 * directory: anyone signed in could list it and harvest every claimed customer number
 * with its owning agent, and two organisations would collide — one silently blocking the
 * other from ever capturing that lead.
 */
export function phoneIndexKey(orgId, phoneNormalized) {
  return `${orgId}_${phoneNormalized}`
}

/** Thrown when the number already belongs to another lead. Carries who owns it. */
export class DuplicateLeadError extends Error {
  constructor({ leadId, ownerId, phone }) {
    super(`Phone ${phone} already belongs to lead ${leadId}`)
    this.name = 'DuplicateLeadError'
    this.code = 'duplicate-lead'
    this.leadId = leadId
    this.ownerId = ownerId
    this.phone = phone
  }
}

export class InvalidPhoneError extends Error {
  constructor(input) {
    super(`Not a usable phone number: ${input}`)
    this.name = 'InvalidPhoneError'
    this.code = 'invalid-phone'
    this.input = input
  }
}

/**
 * Non-blocking duplicate check for the quick-add form, so the agent is warned while they
 * type rather than after they submit (P7).
 *
 * NOT a substitute for the transaction — between this read and the write, another agent
 * can claim the number. Treat a clear result as "probably free", never as "reserved".
 */
export async function checkPhoneAvailable(rawPhone, orgId) {
  const phone = normalizePhone(rawPhone)
  if (!phone) return { valid: false, available: false, phone: null }

  const db = await getDb()
  const snap = await getDoc(doc(db, 'leadPhoneIndex', phoneIndexKey(orgId, phone)))
  if (!snap.exists()) return { valid: true, available: true, phone }

  const { leadId, ownerId } = snap.data()
  return { valid: true, available: false, phone, leadId, ownerId }
}

/**
 * Create a lead and claim its phone number atomically.
 *
 * Throws InvalidPhoneError for an unusable number — we do NOT store junk, because
 * `phoneNormalized` is a primary key and a lead nobody can ring is not a lead.
 * Throws DuplicateLeadError if the number is already claimed.
 *
 * Works offline: Firestore queues the transaction and applies it on reconnect. The caller
 * should treat the returned id as provisional until the write settles — which for a phone
 * lock means a duplicate may only surface later. See the note at the bottom of this file.
 */
export async function createLead({ input, user }) {
  const phone = normalizePhone(input.primaryPhone)
  if (!phone) throw new InvalidPhoneError(input.primaryPhone)

  const db = await getDb()
  const leadRef = doc(collection(db, 'leads'))
  const indexRef = doc(db, 'leadPhoneIndex', phoneIndexKey(user.orgId, phone))
  const now = new Date()

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(indexRef)
    if (existing.exists()) {
      const { leadId, ownerId } = existing.data()
      throw new DuplicateLeadError({ leadId, ownerId, phone })
    }

    const eventDate = input.eventDate ?? null
    const days = eventDate ? urgencyScore.daysFor(eventDate, now) : null

    const qualification = {
      budgetBand: input.budgetBand ?? 'unknown',
      decisionMakerContactId: null,
      committeeMeetsOn: input.committeeMeetsOn ?? null,
      interestedProductIds: input.interestedProductIds ?? [],
    }

    const lead = {
      orgId: user.orgId,
      ownerId: input.ownerId ?? user.uid,
      previousOwnerIds: [],
      teamId: user.teamId ?? null,

      displayName: input.displayName?.trim() || 'Mteja mpya',
      primaryPhone: input.primaryPhone,
      primaryPhoneNormalized: phone,
      altPhones: [],
      email: input.email ?? null,

      eventType: input.eventType ?? 'other',
      eventDate,
      eventDateIsFirm: input.eventDateIsFirm ?? false,
      guestCountEstimate: input.guestCountEstimate ?? null,
      venueArea: input.venueArea ?? null,
      region: input.region ?? null,
      daysToEvent: days,

      stage: 'new',
      stageEnteredAt: serverTimestamp(),
      previousStage: null,
      leadStatus: 'open',

      qualification,
      qualificationScore: qualificationScore({ qualification, guestCountEstimate: input.guestCountEstimate }),
      urgencyScore: urgencyScore(days),
      priorityScore: priorityScore({
        urgency: urgencyScore(days),
        qualification: qualificationScore({ qualification, guestCountEstimate: input.guestCountEstimate }),
        engagement: 0,
      }),

      dealValueMinor: null,
      currency: 'TZS',
      depositPaidMinor: null,

      nextActionAt: input.nextActionAt ?? null,
      nextActionType: input.nextActionType ?? 'call',
      firstContactedAt: null,
      lastContactedAt: null,
      lastActivityAt: serverTimestamp(),
      contactAttempts: 0,
      consecutiveNoAnswer: 0,
      cadence: null,
      isStale: false,

      // Frozen at creation and immutable thereafter — firestore.rules enforces it (P5).
      // Every CAC number in the system is downstream of this object.
      attribution: {
        model: 'first_touch',
        source: input.source ?? 'unknown',
        channel: input.channel ?? input.source ?? 'unknown',
        campaignId: input.campaignId ?? null,
        adsetId: input.adsetId ?? null,
        adId: input.adId ?? null,
        utm: input.utm ?? {},
        referrerCustomerId: input.referrerCustomerId ?? null,
        capturedByUserId: user.uid,
        capturedAt: serverTimestamp(),
      },
      touchpoints: [
        { channel: input.channel ?? input.source ?? 'unknown', campaignId: input.campaignId ?? null, at: now },
      ],

      marketingConsent: input.marketingConsent ?? false,
      consentCapturedAt: input.marketingConsent ? serverTimestamp() : null,
      consentSource: input.marketingConsent ? (input.source ?? 'unknown') : null,

      closedAt: null,
      closedBy: null,
      lossReason: null,
      lossNotes: null,
      parkReason: null,
      customerId: null,
      projectId: null,

      ...periodKeys(now),
      tags: input.tags ?? [],

      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      deletedAt: null,
    }

    tx.set(leadRef, lead)
    tx.set(indexRef, {
      orgId: user.orgId,
      leadId: leadRef.id,
      ownerId: lead.ownerId,
      phoneNormalized: phone,
      createdAt: serverTimestamp(),
    })
  })

  // The creation itself is an activity, so the timeline starts at the true beginning (P1).
  await logActivity({
    leadId: leadRef.id,
    user,
    activity: {
      type: 'system',
      channel: input.channel ?? input.source ?? 'unknown',
      body: 'Lead created',
      meta: { source: input.source ?? 'unknown' },
    },
  })

  return leadRef.id
}

/**
 * Append to the timeline. Never updates, never deletes — a correction is a void
 * (TODO.md P1, and firestore.rules refuses anything else).
 *
 * Also advances the denormalised counters the work queue sorts on, in one batch so the
 * activity and its side effects cannot end up half-written.
 */
export async function logActivity({ leadId, user, activity }) {
  const db = await getDb()
  const leadRef = doc(db, 'leads', leadId)
  const activityRef = doc(collection(db, 'leads', leadId, 'activities'))
  const batch = writeBatch(db)

  batch.set(activityRef, {
    type: activity.type,
    at: serverTimestamp(),
    byUserId: user.uid,
    byUserName: user.displayName ?? null,
    channel: activity.channel ?? null,
    outcome: activity.outcome ?? null,
    durationSec: activity.durationSec ?? null,
    body: activity.body ?? '',
    attachmentPaths: activity.attachmentPaths ?? [],
    meta: activity.meta ?? {},
    isVoided: false,
  })

  const leadPatch = {
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  }

  // These counters feed consecutiveNoAnswer -> engagementScore -> priorityScore, which
  // is the ORDER OF THE WORK QUEUE. They must therefore be atomic field transforms, not
  // a read-modify-write on a value the caller passed in.
  //
  // The previous version did `(activity.currentAttempts ?? 0) + 1`, which meant: a caller
  // who omitted the field silently reset a count of 7 to 1, and two agents logging calls
  // at the same moment both wrote 8 — losing an attempt. increment() is applied by the
  // server against whatever the stored value actually is, and it works offline.
  if (activity.outcome === 'spoke') {
    leadPatch.lastContactedAt = serverTimestamp()
    leadPatch.consecutiveNoAnswer = 0
    // `firestoreServed` note: firstContactedAt is NOT set here. It is a write-once field
    // and a client-supplied boolean cannot be its guard — omitting the flag was
    // indistinguishable from "never contacted", so every later conversation reset the
    // §8.6 response-time clock to now and median first response was permanently ~0.
    // markFirstContact() below does it transactionally instead.
  } else if (['no_answer', 'busy', 'switched_off'].includes(activity.outcome)) {
    leadPatch.consecutiveNoAnswer = increment(1)
  }

  if (['call', 'whatsapp', 'visit', 'sms'].includes(activity.type)) {
    leadPatch.contactAttempts = increment(1)
  }

  batch.update(leadRef, leadPatch)
  await batch.commit()

  // Write-once, decided against the STORED value rather than a client flag.
  if (activity.outcome === 'spoke') {
    await markFirstContact(leadId)
  }

  return activityRef.id
}

/**
 * Stamp `firstContactedAt` the first time anyone actually spoke to this lead.
 *
 * Write-once by construction: the transaction reads the stored value and does nothing if
 * it is already set. This is the input to `firstResponseMins` (TODO.md §8.6), which the
 * plan calls "the top controllable lever" — so it has to be the real first conversation,
 * not the most recent one.
 *
 * Deliberately fire-and-forget from the caller's point of view: it must never block the
 * agent's logging flow (P7), and offline it queues like any other write.
 */
export async function markFirstContact(leadId) {
  const db = await getDb()
  const leadRef = doc(db, 'leads', leadId)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(leadRef)
    if (!snap.exists()) return
    if (snap.data().firstContactedAt) return // already stamped — leave it alone
    tx.update(leadRef, { firstContactedAt: serverTimestamp() })
  })
}

/**
 * Set when this lead should next be touched — the "Remind me…" action (§10.2).
 *
 * This single field is what the work queue sorts and buckets on, and a lead with no
 * `nextActionAt` is invisible to it. Pipedrive's best idea (§3): a lead with no scheduled
 * next action is rotting, and the UI should say so.
 */
export async function setNextAction({ leadId, user, at, type = 'call', reason = null }) {
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId), {
    nextActionAt: at,
    nextActionType: type,
    snoozeReason: reason,
    isStale: false,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

/** Void an activity. The entry stays; a reason is required. */
export async function voidActivity({ leadId, activityId, user, reason }) {
  if (!reason?.trim()) throw new Error('A void reason is required')
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId, 'activities', activityId), {
    isVoided: true,
    voidedBy: user.uid,
    voidReason: reason.trim(),
    voidedAt: serverTimestamp(),
  })
}

/**
 * Move a lead through the pipeline, validating against the state machine first so the UI
 * fails fast with a useful message instead of bouncing off a permission error.
 */
export async function changeStage({ lead, toStage, user, extra = {} }) {
  const proposed = { ...lead, ...extra }
  const check = validateTransition(proposed, toStage)
  if (!check.ok) {
    const error = new Error(check.message)
    error.code = check.code
    error.missing = check.missing
    throw error
  }

  const patch = {
    stage: toStage,
    previousStage: lead.stage,
    stageEnteredAt: serverTimestamp(),
    leadStatus: leadStatusFor(toStage),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    ...extra,
  }

  if (['won', 'lost'].includes(toStage)) {
    patch.closedAt = serverTimestamp()
    patch.closedBy = user.uid
    patch.nextActionAt = null // a closed lead must stop appearing in the work queue
  }

  const db = await getDb()
  await updateDoc(doc(db, 'leads', lead.id), patch)

  await logActivity({
    leadId: lead.id,
    user,
    activity: {
      type: 'stage_change',
      body: `${lead.stage} → ${toStage}`,
      meta: { from: lead.stage, to: toStage, ...extra },
    },
  })
}

/** Reassign a lead. Manager or admin only — firestore.rules enforces it (anti-poaching). */
export async function reassignLead({ lead, toUserId, toUserName, user, reason = '' }) {
  const db = await getDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'leads', lead.id), {
    ownerId: toUserId,
    previousOwnerIds: arrayUnion(lead.ownerId),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  // Keep the phone index pointing at the current owner, so the duplicate warning names
  // the person who can actually help.
  if (lead.primaryPhoneNormalized) {
    batch.update(doc(db, 'leadPhoneIndex', phoneIndexKey(lead.orgId, lead.primaryPhoneNormalized)), {
      ownerId: toUserId,
    })
  }

  await batch.commit()

  await logActivity({
    leadId: lead.id,
    user,
    activity: {
      type: 'assignment',
      body: reason || `Reassigned to ${toUserName ?? toUserId}`,
      meta: { from: lead.ownerId, to: toUserId, reason },
    },
  })
}

/**
 * OFFLINE CAVEAT — read this before "fixing" the duplicate check.
 *
 * Firestore queues a transaction made offline and runs it on reconnect. That means an agent
 * with no signal at a committee meeting CAN create a lead whose phone number turns out to
 * be already claimed; the DuplicateLeadError then surfaces minutes or hours later, when
 * they are no longer looking at the form.
 *
 * This is the correct trade-off: P7 and P8 say capture must never block on the network, and
 * refusing to record a lead because we cannot check a lock would lose real business. The
 * duplicate is a bookkeeping problem; the lost lead is not.
 *
 * What Phase 2 must therefore build: a reconciliation view where a manager sees leads whose
 * phone claim lost the race, and merges them. Do not attempt to make the offline path
 * "safe" by blocking it.
 */
