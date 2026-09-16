/**
 * Collection-group reads across `deals` and `activities` — the dashboard's cross-lead
 * queries. TODO.md §3/§4 (the B22 lesson from the legacy plan, applied proactively here).
 *
 * The load-bearing distinction: a `get()` on the parent lead is provable when `leadId` is
 * fixed (a single lead's subcollection), but NOT for a true `collectionGroup()` query
 * spanning every lead, where `leadId` varies per result. Firestore can only authorise that
 * case from the document's OWN fields — hence `orgId` denormalised onto every deal/activity,
 * and `canReadOrgWide()` checking only `resource.data` + a role claim, never a parent get().
 *
 * These tests are the actual proof that the design decided-by-reasoning in firestore.rules
 * behaves as intended — run them (`npm run test:rules`) before trusting that reasoning.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { collection, collectionGroup, doc, getDocs, query, where } from 'firebase/firestore'
import {
  getTestEnv, teardown, clearData, seed, leadDoc, dealDoc, activityDoc, ORG, OTHER_ORG,
  asAgent, asManager, asAdmin, assertFails, assertSucceeds,
} from './setup.js'

beforeAll(async () => { await getTestEnv() })
afterAll(teardown)
beforeEach(clearData)

async function seedTwoOrgsWorthOfDeals() {
  await seed('leads/l1', leadDoc({ orgId: ORG, ownerId: 'agent1', teamId: 'team-a' }))
  await seed('leads/l1/deals/d1', dealDoc({ orgId: ORG, status: 'closed_won' }))
  await seed('leads/l2', leadDoc({ orgId: OTHER_ORG, ownerId: 'rival1', teamId: 'team-x' }))
  await seed('leads/l2/deals/d1', dealDoc({ orgId: OTHER_ORG, status: 'closed_won' }))
}

describe('deals collection-group read (the dashboard)', () => {
  it('a manager querying WITH an orgId filter sees only their own org\'s deals', async () => {
    await seedTwoOrgsWorthOfDeals()
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    const snap = await getDocs(
      query(collectionGroup(mgr, 'deals'), where('orgId', '==', ORG), where('status', '==', 'closed_won')),
    )
    await assertSucceeds(getDocs(
      query(collectionGroup(mgr, 'deals'), where('orgId', '==', ORG), where('status', '==', 'closed_won')),
    ))
    expect(snap.docs).toHaveLength(1)
    expect(snap.docs[0].data().orgId).toBe(ORG)
  })

  it('a manager querying WITHOUT an orgId filter is rejected outright', async () => {
    await seedTwoOrgsWorthOfDeals()
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    await assertFails(getDocs(query(collectionGroup(mgr, 'deals'), where('status', '==', 'closed_won'))))
  })

  it('an agent cannot run the org-wide collection-group query at all, even scoped', async () => {
    await seedTwoOrgsWorthOfDeals()
    const agent = await asAgent('agent1')
    await assertFails(
      getDocs(query(collectionGroup(agent, 'deals'), where('orgId', '==', ORG), where('status', '==', 'closed_won'))),
    )
  })

  it('an agent CAN still list their own single lead\'s deals (not a collection group)', async () => {
    await seedTwoOrgsWorthOfDeals()
    const agent = await asAgent('agent1')
    await assertSucceeds(getDocs(collection(agent, 'leads/l1/deals')))
  })

  it('an admin querying with an orgId filter also works', async () => {
    await seedTwoOrgsWorthOfDeals()
    const admin = await asAdmin()
    await assertSucceeds(
      getDocs(query(collectionGroup(admin, 'deals'), where('orgId', '==', ORG), where('status', '==', 'closed_won'))),
    )
  })
})

describe('activities collection-group read (the dashboard)', () => {
  async function seedTwoOrgsWorthOfActivities() {
    await seed('leads/l1', leadDoc({ orgId: ORG, ownerId: 'agent1', teamId: 'team-a' }))
    await seed('leads/l1/activities/a1', activityDoc({ orgId: ORG }))
    await seed('leads/l2', leadDoc({ orgId: OTHER_ORG, ownerId: 'rival1', teamId: 'team-x' }))
    await seed('leads/l2/activities/a1', activityDoc({ orgId: OTHER_ORG }))
  }

  it('a manager scoped by orgId sees only their org\'s contact log', async () => {
    await seedTwoOrgsWorthOfActivities()
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    const snap = await getDocs(query(collectionGroup(mgr, 'activities'), where('orgId', '==', ORG)))
    expect(snap.docs).toHaveLength(1)
  })

  it('unscoped is rejected', async () => {
    await seedTwoOrgsWorthOfActivities()
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    await assertFails(getDocs(collectionGroup(mgr, 'activities')))
  })
})
