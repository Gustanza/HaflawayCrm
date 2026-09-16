/**
 * Activity logging — the contact log. TODO.md §3.
 *
 * `logActivity` is the single most-used write in the product: every call, WhatsApp message,
 * SMS or in-person contact goes through it, and it is what advances `nextFollowUpAt` — the
 * field the whole Work Queue is sorted on. It is a transaction, not a batch, because the
 * write-once `firstContactedAt` stamp has to be decided against the value actually stored on
 * the server, not a value the caller happens to be holding.
 */

import { collection, doc, runTransaction, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { periodKeys } from '@/domain/periods.js'

/** How much of a note to carry on the lead as a preview — long enough to be useful, short
 *  enough that the lead document does not become a second copy of the timeline. */
const SUMMARY_PREVIEW_CHARS = 140

function preview(text) {
  const trimmed = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.length > SUMMARY_PREVIEW_CHARS
    ? `${trimmed.slice(0, SUMMARY_PREVIEW_CHARS - 1)}…`
    : trimmed
}

/**
 * Log one contact attempt.
 *
 * `nextFollowUpAt` is required UNLESS this call is logged alongside a deal being closed in
 * the same user action — the caller (the Log Activity dialog) enforces that choice in the
 * form; this function will happily write `null` if asked to, because a rule cannot see the
 * sibling deal-close write to judge whether skipping it was legitimate.
 */
export async function logActivity({
  leadId, user, channel, outcome, summary, dealId = null, nextFollowUpAt = null,
}) {
  const db = await getDb()
  const leadRef = doc(db, 'leads', leadId)
  const activityRef = doc(collection(db, 'leads', leadId, 'activities'))
  const now = new Date()
  const summaryText = preview(summary)

  await runTransaction(db, async (tx) => {
    const leadSnap = await tx.get(leadRef)
    if (!leadSnap.exists()) throw new Error('Lead not found')
    const lead = leadSnap.data()

    tx.set(activityRef, {
      orgId: lead.orgId,
      channel,
      outcome: outcome ?? null,
      summary: summaryText ?? '',
      dealId,
      byUserId: user.uid,
      byUserName: user.displayName ?? null,
      at: serverTimestamp(),
      nextFollowUpAt,
      ...periodKeys(now),
      isVoided: false,
      voidedBy: null,
      voidReason: null,
      voidedAt: null,
    })

    const leadPatch = {
      lastActivityAt: serverTimestamp(),
      nextFollowUpAt,
      lastActivitySummary: summaryText,
      lastActivityChannel: channel,
      lastActivityOutcome: outcome ?? null,
      lastActivityId: activityRef.id,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }

    if (outcome === 'spoke') {
      leadPatch.lastContactedAt = serverTimestamp()
      // Write-once: only stamp firstContactedAt if the STORED value doesn't have one yet.
      // A client-side flag here would be indistinguishable from "never contacted" and would
      // reset the "how fast do we respond" clock on every later conversation.
      if (!lead.firstContactedAt) leadPatch.firstContactedAt = serverTimestamp()
    }

    tx.update(leadRef, leadPatch)
  })

  return activityRef.id
}

/**
 * Void an activity. The entry stays, struck through; a reason is required (enforced by
 * firestore.rules too). If the voided entry is the one the lead's "last contact" preview was
 * copied from, that preview is cleared too — otherwise a note the user explicitly withdrew
 * would keep being quoted on every list that renders the lead.
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

  const { getDoc } = await import('firebase/firestore')
  const leadSnap = await getDoc(leadRef)
  if (leadSnap.exists() && leadSnap.data()?.lastActivityId === activityId) {
    batch.update(leadRef, {
      lastActivitySummary: null,
      lastActivityChannel: null,
      lastActivityOutcome: null,
      lastActivityId: null,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    })
  }

  await batch.commit()
}

/**
 * Set (or clear) when this lead should next be touched, without logging a new contact —
 * the plain "Snooze" action from the lead detail screen, as opposed to logging a call.
 */
export async function setNextFollowUp({ leadId, user, at }) {
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId), {
    nextFollowUpAt: at,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}
