/**
 * Lead persistence. TODO.md §3.
 *
 * The important function here is `createLead`. Everything else is bookkeeping around it.
 *
 * Why the phone lock exists (kept from the legacy plan, unchanged in spirit): the same bride
 * WhatsApps three different Haflaway staff. Without a lock you get three lead records, three
 * reps independently chasing one customer, and a three-way commission fight when she finally
 * books. The lock is a transaction on `leadPhoneIndex/{orgId}_{phone}`, so exactly one create
 * wins even when two agents submit at the same instant.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  arrayUnion,
} from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { normalizePhone } from '@/domain/phone.js'
import { periodKeys } from '@/domain/periods.js'

/** The `leadPhoneIndex` document ID — org-prefixed so it can never leak across orgs (§4). */
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
 * type rather than after they submit.
 *
 * NOT a substitute for the transaction in `createLead` — between this read and the write,
 * another agent can claim the number. Treat a clear result as "probably free", never as
 * "reserved".
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
 * `nextFollowUpAt` defaults to right now: a brand-new lead with zero deals still needs a
 * first touch, and TODO.md §3 says the queue is driven by this field being set — a lead that
 * silently started with none would never show up for anyone to call.
 *
 * Throws InvalidPhoneError for an unusable number — we do NOT store junk, because
 * `primaryPhoneNormalized` is what the duplicate lock is keyed on downstream.
 * Throws DuplicateLeadError if the number is already claimed.
 *
 * Works offline: Firestore queues the transaction and applies it on reconnect. See the note
 * at the bottom of this file for what that means for the duplicate check.
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

      source: input.source ?? 'other',
      referredBy: input.referredBy ?? null,

      eventType: input.eventType ?? null,
      eventDate: input.eventDate ?? null,
      eventDateIsFirm: input.eventDateIsFirm ?? false,

      nextFollowUpAt: input.nextFollowUpAt ?? now,
      nextFollowUpType: input.nextFollowUpType ?? null,
      firstContactedAt: null,
      lastContactedAt: null,
      lastActivityAt: null,

      // Denormalised head of the timeline — see activities.service.js#logActivity. Exists so
      // a list of 25 leads can show "what happened last" without 25 subcollection reads.
      lastActivitySummary: null,
      lastActivityChannel: null,
      lastActivityOutcome: null,
      lastActivityId: null,

      isHot: Boolean(input.isHot),

      ...periodKeys(now),

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

  return leadRef.id
}

/** Generic field patch — isHot, event details, etc. Ownership/orgId changes go elsewhere. */
export async function updateLead({ leadId, patch, user }) {
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

/**
 * Reassign a lead's owner. Manager or admin only — firestore.rules enforces the anti-
 * poaching gate; this just does the write and keeps the phone index pointing at whoever can
 * actually help the customer.
 */
export async function reassignLead({ lead, toUserId, user }) {
  const db = await getDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'leads', lead.id), {
    ownerId: toUserId,
    previousOwnerIds: arrayUnion(lead.ownerId),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  if (lead.primaryPhoneNormalized) {
    batch.update(doc(db, 'leadPhoneIndex', phoneIndexKey(lead.orgId, lead.primaryPhoneNormalized)), {
      ownerId: toUserId,
    })
  }

  await batch.commit()
}

/**
 * OFFLINE CAVEAT — read this before "fixing" the duplicate check.
 *
 * Firestore queues a transaction made offline and runs it on reconnect. That means an agent
 * with no signal at a committee meeting CAN create a lead whose phone number turns out to be
 * already claimed; the DuplicateLeadError then surfaces minutes or hours later, when they are
 * no longer looking at the form. This is the correct trade-off: capture must never block on
 * the network, and refusing to record a lead because we cannot check a lock would lose real
 * business. The duplicate is a bookkeeping problem the owning reps sort out; the lost lead is
 * not recoverable at all.
 */

/* ===========================================================================
 * Hard delete — admin only
 * =========================================================================== */

/**
 * Every subcollection a lead owns, in the order they must be destroyed.
 *
 * Firestore does NOT cascade. Deleting `leads/{id}` leaves `leads/{id}/deals/*` and
 * `leads/{id}/activities/*` alive, unreachable and still billed. Add a subcollection to
 * firestore.rules and it MUST be added here in the same commit, or deleting a lead silently
 * starts orphaning data again.
 */
export const LEAD_SUBCOLLECTIONS = Object.freeze(['deals', 'activities'])

/** Documents per round trip — Firestore caps a WriteBatch at 500; 300 leaves headroom. */
const DELETE_PAGE = 300

export class DeleteNotPermittedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeleteNotPermittedError'
  }
}

/**
 * Empty one subcollection, a page at a time.
 *
 * Loops rather than paginating with a cursor: each pass deletes what it just read, so the
 * next `limit(N)` read of the same collection returns the NEXT N — a cursor would be
 * pointing at a document that no longer exists.
 */
async function purgeSubcollection(db, leadId, name) {
  let removed = 0
  for (;;) {
    const page = await getDocs(query(collection(db, 'leads', leadId, name), fbLimit(DELETE_PAGE)))
    if (page.empty) return removed

    const batch = writeBatch(db)
    page.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    removed += page.size

    if (page.size < DELETE_PAGE) return removed
  }
}

/**
 * Permanently delete a lead and everything that hangs off it. Admin-only, and NOT optimistic
 * — a multi-step cascade queued offline would commit out of order against a document the
 * admin can no longer see, so this awaits every step and the caller must handle the failure.
 *
 * Children first, lead document last: the rules gate a subcollection delete on the parent
 * lead existing (`canReadLeadById`). Deleting the lead first would strand children that no
 * rule could ever again permit anyone to remove.
 */
export async function deleteLead({ lead, user, onProgress = () => {} }) {
  if (user?.role !== 'admin') {
    throw new DeleteNotPermittedError('Only an admin may delete a lead.')
  }
  if (!lead?.id) {
    throw new DeleteNotPermittedError('No lead to delete.')
  }
  if (!lead.orgId || lead.orgId !== user.orgId) {
    throw new DeleteNotPermittedError('That lead belongs to another organisation.')
  }

  const db = await getDb()
  const removed = {}
  for (const name of LEAD_SUBCOLLECTIONS) {
    onProgress({ step: name })
    removed[name] = await purgeSubcollection(db, lead.id, name)
  }

  onProgress({ step: 'phoneIndex' })
  let phoneReleased = false
  if (lead.primaryPhoneNormalized) {
    const indexRef = doc(db, 'leadPhoneIndex', phoneIndexKey(lead.orgId, lead.primaryPhoneNormalized))
    const snap = await getDoc(indexRef)
    // Only if it still points at THIS lead — a reassignment rewrites ownerId, and after an
    // offline duplicate race two leads can share a number with the index naming only one.
    if (snap.exists() && snap.data()?.leadId === lead.id) {
      await writeBatch(db).delete(indexRef).commit()
      phoneReleased = true
    }
  }

  onProgress({ step: 'lead' })
  await writeBatch(db).delete(doc(db, 'leads', lead.id)).commit()

  return { leadId: lead.id, removed, phoneReleased }
}
