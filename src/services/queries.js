/**
 * Canonical, permission-satisfying queries.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE WRITING ANY `query(collection(...))` BY HAND.
 *
 * Firestore security rules are NOT filters. On a `get` the rule is evaluated against the
 * one document you asked for; on a `list` it must be provable from the QUERY CONSTRAINTS
 * alone, before any document is read. So every field a rule touches must appear in the
 * `where()` clauses, or the whole query is rejected.
 *
 * This is invisible in a unit test and invisible in a rules test that only exercises
 * `get`. Measured against the real emulator:
 *
 *   agent, where(ownerId == me)                  -> DENIED
 *       "Property orgId is undefined on object. for 'list'"
 *   agent, where(orgId == mine, ownerId == me)   -> ALLOWED
 *   agent, where(orgId == mine)                  -> DENIED
 *       "Property ownerId is undefined on object. for 'list'"
 *
 * Every list screen in Phase 2 — the lead list, work queue, pipeline, urgency board —
 * would have been dead on arrival. Use the builders here; they encode what each role's
 * rule can actually prove.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Verified constraint matrix (emulator, all five roles):
 *
 *   collection        agent            manager          finance/admin/viewer
 *   ---------------------------------------------------------------------------
 *   leads             orgId + ownerId  orgId + teamId   orgId
 *   tasks             orgId + ownerId  orgId + teamId   orgId
 *   campaignsPublic   orgId            orgId            orgId
 *   campaigns         DENIED           orgId            orgId (not viewer)
 *   expenses          DENIED           orgId            orgId (not viewer)
 */

import { collection, query, where, orderBy, limit as fbLimit, startAfter, getDocs } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'

/** Roles whose rule grants org-wide lead reads from CLAIMS alone (§7.1). */
const ORG_WIDE_LEAD_ROLES = ['admin', 'finance', 'viewer']

/** Roles that may list cost collections. Viewer deliberately excluded. */
const COST_ROLES = ['admin', 'finance', 'manager']

function assertUser(user) {
  if (!user?.orgId) {
    throw new Error(
      'A query needs the caller orgId. Pass the auth store user — every list rule requires it.',
    )
  }
}

/**
 * The scope a user's own rule can prove for leads and tasks.
 * Returns the `where` clauses to apply, or throws if the role may not list at all.
 */
function ownershipScope(user, { ownerField = 'ownerId', teamField = 'teamId' } = {}) {
  if (ORG_WIDE_LEAD_ROLES.includes(user.role)) return []
  if (user.role === 'manager') {
    if (!user.teamId) throw new Error('Manager has no teamId claim — run scripts/syncClaims.js')
    return [where(teamField, '==', user.teamId)]
  }
  if (user.role === 'agent') return [where(ownerField, '==', user.uid)]
  throw new Error(`Role "${user.role}" may not list this collection.`)
}

/* ---------------------------------------------------------------------- leads */

/**
 * Leads the caller is allowed to list.
 *
 * `scope` overrides the default for a role that has a choice:
 *   'auto' (default) — the widest scope the role's rule can prove
 *   'mine'           — only this user's leads (a manager viewing their own pipeline)
 *   'team'           — the caller's team (manager and above)
 */
export async function leadsQuery(user, { scope = 'auto', stage, leadStatus, order, max = 25, after } = {}) {
  assertUser(user)
  const db = await getDb()

  let scopeClauses
  if (scope === 'mine') scopeClauses = [where('ownerId', '==', user.uid)]
  else if (scope === 'team') {
    if (!user.teamId) throw new Error('No teamId claim for a team-scoped query.')
    scopeClauses = [where('teamId', '==', user.teamId)]
  } else scopeClauses = ownershipScope(user)

  const clauses = [
    // ALWAYS first. Without it every list rule fails to evaluate (see the header).
    where('orgId', '==', user.orgId),
    ...scopeClauses,
  ]

  if (stage) clauses.push(where('stage', '==', stage))
  if (leadStatus) clauses.push(where('leadStatus', '==', leadStatus))
  if (order) clauses.push(orderBy(order.field, order.direction ?? 'asc'))
  if (after) clauses.push(startAfter(after))
  clauses.push(fbLimit(max))

  return query(collection(db, 'leads'), ...clauses)
}

/** Open leads sorted by event date — the urgency board (§12 screen 7, P2). */
export async function urgencyBoardQuery(user, { max = 50 } = {}) {
  return leadsQuery(user, {
    leadStatus: 'open',
    order: { field: 'eventDate', direction: 'asc' },
    max,
  })
}

/** The claimable pool: leads nobody owns yet. */
export async function unownedLeadsQuery(user, { max = 25 } = {}) {
  assertUser(user)
  const db = await getDb()
  return query(
    collection(db, 'leads'),
    where('orgId', '==', user.orgId),
    where('ownerId', '==', null),
    orderBy('createdAt', 'desc'),
    fbLimit(max),
  )
}

/* ---------------------------------------------------------------------- tasks */

/** The work queue (§10.3). Sorted by due date; the caller re-sorts by priorityScore. */
export async function tasksQuery(user, { scope = 'auto', status = 'open', max = 50 } = {}) {
  assertUser(user)
  const db = await getDb()

  const scopeClauses =
    scope === 'mine'
      ? [where('ownerId', '==', user.uid)]
      : ownershipScope(user)

  const clauses = [where('orgId', '==', user.orgId), ...scopeClauses]
  if (status) clauses.push(where('status', '==', status))
  clauses.push(orderBy('dueAt', 'asc'), fbLimit(max))

  return query(collection(db, 'tasks'), ...clauses)
}

/* ------------------------------------------------------------------ reference */

/**
 * Campaign names for lead attribution. Reads the REDACTED mirror, never `campaigns` —
 * agents must not see budgets (§7.1) and Firestore cannot hide a field.
 */
export async function campaignOptionsQuery(user) {
  assertUser(user)
  const db = await getDb()
  return query(
    collection(db, 'campaignsPublic'),
    where('orgId', '==', user.orgId),
    fbLimit(100),
  )
}

/* ---------------------------------------------------------------------- money */

function assertCostAccess(user) {
  assertUser(user)
  if (!COST_ROLES.includes(user.role)) {
    // Fail here with something a developer can act on, rather than letting the rules
    // return an opaque permission error at runtime.
    throw new Error(
      `Role "${user.role}" may not read cost data (TODO.md §7.1). Use campaignOptionsQuery().`,
    )
  }
}

export async function expensesQuery(user, { monthKey, staffId, campaignId, max = 100 } = {}) {
  assertCostAccess(user)
  const db = await getDb()

  const clauses = [where('orgId', '==', user.orgId)]
  if (monthKey) clauses.push(where('monthKey', '==', monthKey))
  if (staffId) clauses.push(where('allocation.staffId', '==', staffId))
  if (campaignId) clauses.push(where('allocation.campaignId', '==', campaignId))
  clauses.push(fbLimit(max))

  return query(collection(db, 'expenses'), ...clauses)
}

export async function campaignsQuery(user, { max = 50 } = {}) {
  assertCostAccess(user)
  const db = await getDb()
  return query(collection(db, 'campaigns'), where('orgId', '==', user.orgId), fbLimit(max))
}

/**
 * Every spend entry for the given campaigns, flattened into one array.
 *
 * Not a single Firestore query: `campaigns/{id}/spend` is a per-campaign subcollection with
 * no `orgId` of its own (see firestore.rules' `campaignInMyOrg()`), so there is no one
 * collection to `where('orgId', ...)` against. This is a bounded fan-out over the org's own
 * campaign list instead — cheap at the scale this product targets (a handful of campaigns,
 * dozens of spend entries each), and it is the ONLY source of truth for what a campaign has
 * actually spent. `campaign.spendToDateMinor` looks like a summary field but nothing in this
 * codebase ever writes it from real spend entries — treat it as decorative, never as data.
 */
export async function fetchCampaignSpend(user, campaignIds) {
  // Checked in this order deliberately: a role with no cost access always has an empty
  // campaign list to pass in here, and that must return [] quietly rather than throw.
  if (!campaignIds?.length) return []
  assertCostAccess(user)
  const db = await getDb()
  const snapshots = await Promise.all(
    campaignIds.map((campaignId) => getDocs(collection(db, 'campaigns', campaignId, 'spend'))),
  )
  return snapshots.flatMap((snap, i) =>
    snap.docs.map((d) => ({ id: d.id, campaignId: campaignIds[i], ...d.data() })),
  )
}
