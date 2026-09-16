/**
 * Canonical, permission-satisfying queries. TODO.md §3/§4.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE WRITING ANY `query(collection(...))` BY HAND.
 *
 * Firestore security rules are NOT filters. On a `get` the rule is evaluated against the one
 * document you asked for; on a `list` — including a `collectionGroup()` query — it must be
 * provable from the QUERY CONSTRAINTS alone, before any document is read. So every field a
 * rule touches must appear in a `where()` clause, or the whole query is rejected outright.
 *
 * Verified against the real emulator (`npm run test:rules`):
 *   leads:      agent  -> orgId + ownerId   · manager -> orgId + teamId   · admin -> orgId alone
 *   deals/activities (single lead's subcollection): same as the parent lead's access.
 *   deals/activities (collectionGroup, the dashboard): orgId equality filter is MANDATORY,
 *     and only a manager/admin's claim satisfies the rest — see canReadOrgWide() in
 *     firestore.rules. An agent's collection-group query is rejected outright, by design;
 *     agents only ever read a single lead's own deals/activities subcollection.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  collection, collectionGroup, query, where, orderBy, limit as fbLimit, startAfter,
} from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'

function assertUser(user) {
  if (!user?.orgId) {
    throw new Error('A query needs the caller orgId — pass the auth store user.')
  }
}

/** The `where` clauses the caller's OWN rule can prove for leads (and their sub-reads). */
function ownershipScope(user) {
  if (user.role === 'admin') return []
  if (user.role === 'manager') {
    if (!user.teamId) throw new Error('Manager has no teamId claim — run scripts/syncClaims.js')
    return [where('teamId', '==', user.teamId)]
  }
  if (user.role === 'agent') return [where('ownerId', '==', user.uid)]
  throw new Error(`Role "${user.role}" may not list leads.`)
}

/* ---------------------------------------------------------------------- leads */

/** The Work Queue: this user's (or team's) leads, soonest follow-up first. */
export async function workQueueQuery(user, { max = 100 } = {}) {
  assertUser(user)
  const db = await getDb()
  return query(
    collection(db, 'leads'),
    where('orgId', '==', user.orgId),
    ...ownershipScope(user),
    orderBy('nextFollowUpAt', 'asc'),
    fbLimit(max),
  )
}

/** Lead list — most recently touched first. */
export async function leadListQuery(user, { max = 50, after } = {}) {
  assertUser(user)
  const db = await getDb()
  const clauses = [
    where('orgId', '==', user.orgId),
    ...ownershipScope(user),
    orderBy('updatedAt', 'desc'),
  ]
  if (after) clauses.push(startAfter(after))
  clauses.push(fbLimit(max))
  return query(collection(db, 'leads'), ...clauses)
}

/** Leads with an event inside [start, end) — the dashboard's "upcoming events". */
export async function upcomingEventsQuery(user, { start, end, max = 100 } = {}) {
  assertUser(user)
  if (!start || !end) throw new Error('upcomingEventsQuery needs start and end')
  const db = await getDb()
  return query(
    collection(db, 'leads'),
    where('orgId', '==', user.orgId),
    where('eventDate', '>=', start),
    where('eventDate', '<', end),
    orderBy('eventDate', 'asc'),
    fbLimit(max),
  )
}

/** Leads flagged hot — the dashboard's "most promising right now". */
export async function hotLeadsQuery(user, { max = 20 } = {}) {
  assertUser(user)
  const db = await getDb()
  return query(
    collection(db, 'leads'),
    where('orgId', '==', user.orgId),
    ...ownershipScope(user),
    where('isHot', '==', true),
    fbLimit(max),
  )
}

/**
 * Leads created in one period — one of the dashboard's four volume counts.
 * `periodField` is one of 'dayKey' | 'weekKey' | 'monthKey' | 'quarterKey'.
 */
export async function leadsCreatedInPeriodQuery(user, { periodField, periodValue, max = 500 } = {}) {
  assertUser(user)
  const db = await getDb()
  return query(
    collection(db, 'leads'),
    where('orgId', '==', user.orgId),
    where(periodField, '==', periodValue),
    fbLimit(max),
  )
}

/* --------------------------------------------------------- deals (collection group) */

/**
 * Deals closed in one period, org-wide — the dashboard's "closed by product" breakdown.
 * Manager/admin only (see canReadOrgWide() in firestore.rules); an agent gets a permission
 * error here by design, since the dashboard screen itself is manager/admin-only (TODO.md §5).
 */
export async function dealsClosedInPeriodQuery(user, { status, periodField, periodValue, max = 1000 } = {}) {
  assertUser(user)
  const db = await getDb()
  const closedField = `closed${periodField[0].toUpperCase()}${periodField.slice(1)}`
  return query(
    collectionGroup(db, 'deals'),
    where('orgId', '==', user.orgId),
    where('status', '==', status),
    where(closedField, '==', periodValue),
    fbLimit(max),
  )
}

/** One lead's deals — the product cards on the Lead Detail screen. */
export async function leadDealsQuery(leadId) {
  const db = await getDb()
  return query(collection(db, 'leads', leadId, 'deals'))
}

/* ----------------------------------------------------- activities (collection group) */

/** Contacts made org-wide in one period — the dashboard's "calls made today" style count. */
export async function activitiesInPeriodQuery(user, { periodField, periodValue, max = 2000 } = {}) {
  assertUser(user)
  const db = await getDb()
  return query(
    collectionGroup(db, 'activities'),
    where('orgId', '==', user.orgId),
    where(periodField, '==', periodValue),
    fbLimit(max),
  )
}

/** One lead's timeline, newest first — the Lead Detail screen. */
export async function leadTimelineQuery(leadId, { max = 50, after } = {}) {
  const db = await getDb()
  const clauses = [collection(db, 'leads', leadId, 'activities'), orderBy('at', 'desc')]
  if (after) clauses.push(startAfter(after))
  clauses.push(fbLimit(max))
  return query(...clauses)
}
