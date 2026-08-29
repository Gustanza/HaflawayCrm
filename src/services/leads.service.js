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
  getDocs,
  increment,
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
import { leadStatusFor, validateTransition, TERMINAL_STAGES } from '@/domain/stages.js'
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
      // `days` is REQUIRED here, exactly as in recomputeScores() — omitting it skips the
      // urgency floor (scoring.js §), so a lead with an event 5 days out was stored at 50
      // instead of the 90 every view actually renders when it recomputes fresh from eventDate.
      priorityScore: priorityScore({
        urgency: urgencyScore(days),
        qualification: qualificationScore({ qualification, guestCountEstimate: input.guestCountEstimate }),
        engagement: 0,
        days,
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

      /**
       * A denormalised copy of the most recent timeline entry - see logActivity().
       *
       * The timeline is still the record (P1); this is a cache of its head, and it exists
       * so a LIST of leads can show what happened last without reading a subcollection per
       * row. Rendering 25 rows would otherwise cost 25 extra queries (11.3), which is why
       * the work queue used to show that a lead was overdue without ever saying why.
       */
      lastOutcome: null,
      lastActivityType: null,
      lastNote: null,
      lastActivityId: null,
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
/**
 * How much of a note to carry on the lead. Long enough to be the sentence that tells an
 * agent what to do ("wants the quote by Friday"), short enough that a lead document does
 * not quietly become a second copy of its own timeline.
 */
const NOTE_PREVIEW_CHARS = 140

function summarise(body) {
  const text = String(body ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length > NOTE_PREVIEW_CHARS ? `${text.slice(0, NOTE_PREVIEW_CHARS - 1)}\u2026` : text
}

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

    // The head of the timeline, copied onto the lead so a list can render it. Written on
    // EVERY activity including a bare note, because "what happened last" is the question
    // an agent has before dialling, and a note is often the answer.
    lastOutcome: activity.outcome ?? null,
    lastActivityType: activity.type ?? null,
    // Truncated: this is a preview for one table cell, not a second copy of the record.
    // The full text lives in the activity, which is what the lead detail page reads.
    lastNote: summarise(activity.body),
    // Which entry this summary came from, so voiding that entry can retract it precisely
    // rather than blanking a summary that some OTHER, still-valid activity produced.
    lastActivityId: activityRef.id,
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
    await markFirstContact(leadId, user)
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
 *
 * `updatedAt`/`updatedBy` are NOT incidental here — firestore.rules' updateStamped() refuses
 * ANY lead update that omits them, `firstContactedAt` included. Leaving them off meant this
 * write was rejected outright, every single time, on the single most common activity outcome
 * an agent logs ("we spoke") — the exception surfaced up through logActivity() as a save
 * failure, even though the activity entry itself (a separate, already-committed batch) had
 * saved fine.
 */
export async function markFirstContact(leadId, user) {
  const db = await getDb()
  const leadRef = doc(db, 'leads', leadId)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(leadRef)
    if (!snap.exists()) return
    if (snap.data().firstContactedAt) return // already stamped — leave it alone
    tx.update(leadRef, {
      firstContactedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    })
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

/**
 * Void an activity. The entry stays; a reason is required.
 *
 * If the voided entry is the one the lead's `lastOutcome`/`lastNote` was copied from, that
 * copy is retracted too. Otherwise a note the user has explicitly withdrawn would go on
 * being quoted in every list that renders the lead - the retraction would be visible only
 * to whoever opened the timeline, which is exactly the person who already knows.
 *
 * Only when the ids match: voiding some older entry must not blank a summary that a newer,
 * still-valid activity produced.
 */
export async function voidActivity({ leadId, activityId, user, reason }) {
  if (!reason?.trim()) throw new Error('A void reason is required')
  const db = await getDb()
  const leadRef = doc(db, 'leads', leadId)

  const batch = writeBatch(db)
  batch.update(doc(db, 'leads', leadId, 'activities', activityId), {
    isVoided: true,
    voidedBy: user.uid,
    voidReason: reason.trim(),
    voidedAt: serverTimestamp(),
  })

  const leadSnap = await getDoc(leadRef)
  if (leadSnap.exists() && leadSnap.data()?.lastActivityId === activityId) {
    batch.update(leadRef, {
      lastOutcome: null,
      lastActivityType: null,
      lastNote: null,
      lastActivityId: null,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    })
  }

  await batch.commit()
}

/**
 * Move a lead through the pipeline, validating against the state machine first so the UI
 * fails fast with a useful message instead of bouncing off a permission error.
 */
export async function changeStage({ lead, toStage, user, extra = {} }) {
  const proposed = { ...lead, ...extra }
  // The role decides one thing only: whether a CLOSED lead may be pulled back open. Every
  // other move is open to anyone who can write the lead.
  const check = validateTransition(proposed, toStage, { role: user?.role })
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

  // firestore.rules' closureFieldsPresent() requires closedAt/closedBy for EVERY terminal
  // stage — won, lost, AND disqualified. This used to check only ['won', 'lost'], so moving
  // a lead to disqualified never stamped them, and the write was refused for every caller,
  // including a genuine admin — "Missing or insufficient permissions" with no way to act on
  // it, on the single most common way an unfit lead ever gets closed out.
  if (TERMINAL_STAGES.includes(toStage)) {
    patch.closedAt = serverTimestamp()
    patch.closedBy = user.uid
    patch.nextActionAt = null // a closed lead must stop appearing in the work queue
  } else if (TERMINAL_STAGES.includes(lead.stage)) {
    // REOPENING. Clear the closure stamps, or the lead is open again while still claiming
    // to have been closed on a date by a person — and §8 reads those fields. The reason
    // (lossReason / parkReason) is deliberately LEFT: it is a historical fact about a
    // close that really did happen, and the timeline already records the reopening.
    patch.closedAt = null
    patch.closedBy = null
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

/* ===========================================================================
 * Hard delete
 * =========================================================================== */

/**
 * Every collection a lead owns, in the order they must be destroyed.
 *
 * Firestore does NOT cascade. Deleting `leads/{id}` leaves `leads/{id}/activities/*` alive,
 * unreachable and still billed — a path keeps working as a path even when no document sits
 * at it. So each subcollection is walked and emptied explicitly, and this list is the
 * single place that knowledge lives. Add a subcollection to firestore.rules and it MUST be
 * added here in the same commit, or deleting a lead silently starts orphaning data again.
 *
 * Current subcollections, from firestore.rules `match /leads/{leadId}`:
 *   activities · contacts · quotes
 */
export const LEAD_SUBCOLLECTIONS = Object.freeze(['activities', 'contacts', 'quotes'])

/**
 * Documents per round trip. Firestore caps a WriteBatch at 500 operations; 300 leaves
 * headroom and keeps each commit small enough to retry cheaply.
 */
const DELETE_PAGE = 300

/** Raised when a delete is attempted by someone, or against something, it must not touch. */
export class DeleteNotPermittedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeleteNotPermittedError'
  }
}

/**
 * Empty one subcollection, a page at a time, and report how many documents went.
 *
 * Loops rather than paginating with a cursor: each pass deletes what it just read, so the
 * next `limit(N)` read of the same collection returns the NEXT N. A cursor would be
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

    // A short page means the collection is now empty — no point paying for one more read
    // to be told so.
    if (page.size < DELETE_PAGE) return removed
  }
}

/**
 * Permanently delete a lead and everything that hangs off it.
 *
 * WHY A HARD DELETE EXISTS AT ALL, against TODO.md §249
 * ----------------------------------------------------
 * The written policy is soft delete only, and it is the right default — `deletedAt` is
 * cheaper, reversible, and keeps history intact. This is a deliberate, explicitly requested
 * exception: an admin needs a way to make a record and its whole footprint genuinely go
 * away (a test lead, a duplicate, a customer exercising erasure), and a soft delete leaves
 * the phone lock, the timeline and the PII exactly where they were. Admin-only, audited,
 * and typed-confirmation gated, because it cannot be undone.
 *
 * WHAT IT COSTS, stated plainly so nobody rediscovers it in a board meeting
 * ------------------------------------------------------------------------
 * `attribution` is frozen at creation and is what every CAC figure is computed from (§P5).
 * Deleting a WON lead leaves the campaign's spend untouched while removing one conversion,
 * so that campaign's historical CAC gets worse the moment this runs. Money documents are an
 * immutable ledger (§P4) and are deliberately NOT touched — a deleted lead does not refund
 * the money spent acquiring it. The tombstone below is what lets a CAC that moved be
 * explained afterwards.
 *
 * ORDER MATTERS, and it is children-first for one specific reason
 * --------------------------------------------------------------
 * The rules gate a subcollection delete on the PARENT lead existing and being in your org
 * (`canReadLeadById`). Delete the lead first and a half-finished run strands children that
 * no rule will ever again permit anyone to remove. So the lead document goes LAST, and any
 * failure part-way leaves a still-deletable lead that re-running finishes.
 *
 * NOT OPTIMISTIC, unlike every other write in this file
 * ----------------------------------------------------
 * P8 makes writes fire-and-forget so an agent offline at a committee meeting is never
 * blocked. That is exactly wrong here: a multi-step cascade queued offline would commit
 * days later, out of order, against a document the admin can no longer see. This awaits
 * every step, and the caller must handle the failure.
 */
export async function deleteLead({ lead, user, reason, onProgress = () => {} }) {
  if (user?.role !== 'admin') {
    throw new DeleteNotPermittedError('Only an admin may delete a lead.')
  }
  if (!lead?.id) {
    throw new DeleteNotPermittedError('No lead to delete.')
  }
  // Multi-tenancy is worth re-checking on the client even though the rules enforce it: a
  // mis-wired caller should fail here, loudly and before touching anything, rather than
  // getting a permission error three collections deep into a cascade.
  if (!lead.orgId || lead.orgId !== user.orgId) {
    throw new DeleteNotPermittedError('That lead belongs to another organisation.')
  }
  if (!reason || !String(reason).trim()) {
    throw new DeleteNotPermittedError('A reason is required to delete a lead.')
  }

  const db = await getDb()
  const trimmedReason = String(reason).trim()

  /**
   * The tombstone, written BEFORE anything is destroyed.
   *
   * Keyed by leadId, so a retry after a partial failure overwrites rather than
   * accumulating, and so any later question about a missing lead has exactly one place to
   * be answered.
   *
   * DELIBERATELY CARRIES NO PII — no name, no phone number, no note bodies. Keeping the
   * customer's number in an audit record would mean "delete" had not deleted it, which
   * defeats the erasure case this function exists to serve. What it keeps is what a
   * deletion needs in order to be accountable: who, when, why, and the attribution needed
   * to explain a CAC that moved.
   */
  const tombstoneRef = doc(db, 'leadDeletions', lead.id)
  await setDoc(tombstoneRef, {
    leadId: lead.id,
    orgId: lead.orgId,
    deletedBy: user.uid,
    deletedByName: user.displayName ?? null,
    deletedAt: serverTimestamp(),
    reason: trimmedReason,
    // Forensics, not identity.
    stage: lead.stage ?? null,
    leadStatus: lead.leadStatus ?? null,
    ownerId: lead.ownerId ?? null,
    attribution: lead.attribution ?? null,
    dealValueMinor: lead.dealValueMinor ?? null,
    // Records THAT a number was released, without recording the number.
    phoneReleased: false,
    removed: {},
    completedAt: null,
  })

  const removed = {}
  for (const name of LEAD_SUBCOLLECTIONS) {
    onProgress({ step: name })
    removed[name] = await purgeSubcollection(db, lead.id, name)
  }

  /**
   * Release the duplicate lock — but ONLY if it still points at this lead.
   *
   * The index is keyed `{orgId}_{phone}`, not by leadId, so it can legitimately belong to a
   * DIFFERENT lead: a reassignment rewrites its ownerId, and after an offline duplicate
   * race two leads can share a number with the index naming only one. Deleting it blind
   * would strip a live lead of its lock and let the same customer be captured twice.
   *
   * Leaving a stale entry behind is the worse failure in the other direction: the number
   * becomes permanently un-addable, and the customer who rings back can never be re-entered.
   */
  onProgress({ step: 'phoneIndex' })
  let phoneReleased = false
  if (lead.primaryPhoneNormalized) {
    const indexRef = doc(
      db,
      'leadPhoneIndex',
      phoneIndexKey(lead.orgId, lead.primaryPhoneNormalized),
    )
    const snap = await getDoc(indexRef)
    if (snap.exists() && snap.data()?.leadId === lead.id) {
      const batch = writeBatch(db)
      batch.delete(indexRef)
      await batch.commit()
      phoneReleased = true
    }
  }

  // LAST. See the ordering note above — while this document exists, a failed run is still
  // recoverable by simply running again.
  onProgress({ step: 'lead' })
  const leadBatch = writeBatch(db)
  leadBatch.delete(doc(db, 'leads', lead.id))
  await leadBatch.commit()

  await updateDoc(tombstoneRef, {
    removed,
    phoneReleased,
    completedAt: serverTimestamp(),
  })

  return { leadId: lead.id, removed, phoneReleased }
}
