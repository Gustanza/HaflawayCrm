/**
 * Deal persistence — one document per product a lead has engaged with. TODO.md §3.
 *
 * The whole point of this collection: "closed for reminders, still open for the invitation"
 * has to be representable, which a single `stage` field on the lead cannot do. Each deal
 * closes independently.
 */

import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { periodKeys } from '@/domain/periods.js'

export class DuplicateOpenDealError extends Error {
  constructor(productType) {
    super(`There is already an open ${productType} deal on this lead.`)
    this.name = 'DuplicateOpenDealError'
    this.code = 'duplicate-open-deal'
    this.productType = productType
  }
}

/**
 * Add a new product to a lead. Refuses a second OPEN deal of the same product — a lead can
 * legitimately have a `closed_lost` invitation deal and later a new open one (they came
 * back), but never two open ones at once, which would just be confusing to work.
 */
export async function addDeal({ leadId, orgId, productType, user }) {
  const db = await getDb()

  const existingOpen = await getDocs(
    query(
      collection(db, 'leads', leadId, 'deals'),
      where('productType', '==', productType),
      where('status', '==', 'open'),
    ),
  )
  if (!existingOpen.empty) throw new DuplicateOpenDealError(productType)

  const dealRef = doc(collection(db, 'leads', leadId, 'deals'))
  await setDoc(dealRef, {
    orgId,
    productType,
    status: 'open',
    closedAt: null,
    closedBy: null,
    lostReason: null,
    closedDayKey: null,
    closedWeekKey: null,
    closedMonthKey: null,
    closedQuarterKey: null,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  return dealRef.id
}

/**
 * Close a deal won or lost. `lostReason` is required for a loss — firestore.rules enforces
 * this too, but failing fast here means the agent sees a form validation, not a Firebase
 * permission error.
 */
export async function closeDeal({ leadId, dealId, status, lostReason = null, user }) {
  if (status !== 'closed_won' && status !== 'closed_lost') {
    throw new Error(`closeDeal status must be closed_won or closed_lost, got "${status}"`)
  }
  if (status === 'closed_lost' && !lostReason?.trim()) {
    throw new Error('A reason is required to close a deal as lost.')
  }

  const db = await getDb()
  const now = new Date()
  const keys = periodKeys(now)

  await updateDoc(doc(db, 'leads', leadId, 'deals', dealId), {
    status,
    closedAt: serverTimestamp(),
    closedBy: user.uid,
    lostReason: status === 'closed_lost' ? lostReason.trim() : null,
    closedDayKey: keys.dayKey,
    closedWeekKey: keys.weekKey,
    closedMonthKey: keys.monthKey,
    closedQuarterKey: keys.quarterKey,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

/** Reopen a closed deal. Manager/admin only — firestore.rules enforces it. */
export async function reopenDeal({ leadId, dealId, user }) {
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId, 'deals', dealId), {
    status: 'open',
    closedAt: null,
    closedBy: null,
    lostReason: null,
    closedDayKey: null,
    closedWeekKey: null,
    closedMonthKey: null,
    closedQuarterKey: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}
