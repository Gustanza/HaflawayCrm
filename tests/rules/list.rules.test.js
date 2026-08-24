/**
 * LIST (query) authorisation.
 *
 * The gap that made this file necessary: the other 108 rules tests all exercise `get` on a
 * single document, and `get` behaves completely differently from `list`.
 *
 * On a `get`, the rule is evaluated against the one document requested, so
 * `resource.data.orgId` is a real value. On a `list`, the rule must be provable from the
 * QUERY CONSTRAINTS before any document is read — so any field the rule touches that the
 * query does not constrain makes the whole query fail with
 * "Property <field> is undefined on object".
 *
 * Consequence, measured against the emulator: an agent querying
 * `where('ownerId','==',me)` was DENIED, because the rule also reads `orgId`. Every list
 * screen in the product would have been dead, and no existing test could see it.
 *
 * These tests pin the constraint matrix that `src/services/queries.js` encodes.
 */
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import {
  getTestEnv,
  teardown,
  clearData,
  seed,
  leadDoc,
  ORG,
  OTHER_ORG,
  as,
  asAgent,
  asManager,
  asFinance,
  asAdmin,
  assertFails,
  assertSucceeds,
} from './setup.js'

beforeAll(async () => {
  await getTestEnv()
})
afterAll(teardown)

beforeEach(async () => {
  await clearData()
  await seed('leads/l1', leadDoc({ ownerId: 'agent1', teamId: 'team-a' }))
  await seed('leads/l2', leadDoc({ ownerId: 'agent2', teamId: 'team-a' }))
  await seed('leads/l3', leadDoc({ ownerId: 'agent5', teamId: 'team-b' }))
  await seed('leads/l4', leadDoc({ ownerId: null, teamId: null })) // the claimable pool
  await seed('tasks/t1', {
    orgId: ORG, ownerId: 'agent1', teamId: 'team-a', leadId: 'l1',
    title: 'Fuatilia', status: 'open', dueAt: new Date(),
  })
  await seed('expenses/e1', {
    orgId: ORG, category: 'salary', amountMinor: 40000000, monthKey: '2026-08',
    allocation: { type: 'staff', staffId: 'agent1' }, enteredBy: 'finance1',
  })
  await seed('campaignsPublic/c1', { orgId: ORG, name: 'IG August', channel: 'instagram' })
})

const leads = (db) => collection(db, 'leads')

describe('an unconstrained query is rejected — rules are not filters', () => {
  it('denies a bare collection listing to everyone, admin included', async () => {
    await assertFails(getDocs(query(leads(await asAgent('agent1')), limit(5))))
    await assertFails(getDocs(query(leads(await asAdmin()), limit(5))))
  })

  it('denies an agent a query that omits orgId, even filtered to their own leads', async () => {
    // The exact failure that would have broken every list screen.
    const db = await asAgent('agent1')
    await assertFails(getDocs(query(leads(db), where('ownerId', '==', 'agent1'), limit(5))))
  })

  it('denies an agent a query that omits ownership, even scoped to their org', async () => {
    const db = await asAgent('agent1')
    await assertFails(getDocs(query(leads(db), where('orgId', '==', ORG), limit(5))))
  })

  it('ALLOWS the fully-constrained query the query builder produces', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('ownerId', '==', 'agent1'), limit(5))),
    )
  })
})

describe('the constraint matrix per role', () => {
  it('agent: orgId + ownerId', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('ownerId', '==', 'agent1'), limit(5))),
    )
    // …but not a colleague's, and not a whole team.
    await assertFails(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('ownerId', '==', 'agent2'), limit(5))),
    )
    await assertFails(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('teamId', '==', 'team-a'), limit(5))),
    )
  })

  it('agent: can list the unowned pool', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('ownerId', '==', null), limit(5))),
    )
  })

  it('manager: orgId + teamId, and only their own team', async () => {
    const db = await asManager('manager1', { teamId: 'team-a' })
    await assertSucceeds(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('teamId', '==', 'team-a'), limit(5))),
    )
    await assertFails(
      getDocs(query(leads(db), where('orgId', '==', ORG), where('teamId', '==', 'team-b'), limit(5))),
    )
  })

  it('finance, admin and viewer: orgId alone is enough', async () => {
    for (const db of [await asFinance(), await asAdmin(), await as('viewer1', { role: 'viewer' })]) {
      await assertSucceeds(getDocs(query(leads(db), where('orgId', '==', ORG), limit(5))))
    }
  })

  it('nobody can list another organisation', async () => {
    const rival = await as('rival', { role: 'admin', orgId: OTHER_ORG })
    await assertFails(getDocs(query(leads(rival), where('orgId', '==', ORG), limit(5))))
  })
})

describe('tasks follow the same shape', () => {
  it('agent lists their own; manager lists the team', async () => {
    const agent = await asAgent('agent1')
    await assertSucceeds(
      getDocs(
        query(collection(agent, 'tasks'), where('orgId', '==', ORG), where('ownerId', '==', 'agent1'), limit(5)),
      ),
    )
    await assertFails(
      getDocs(
        query(collection(agent, 'tasks'), where('orgId', '==', ORG), where('ownerId', '==', 'agent2'), limit(5)),
      ),
    )

    const manager = await asManager('manager1', { teamId: 'team-a' })
    await assertSucceeds(
      getDocs(
        query(collection(manager, 'tasks'), where('orgId', '==', ORG), where('teamId', '==', 'team-a'), limit(5)),
      ),
    )
  })
})

describe('cost collections stay closed to agents and viewers, on list too', () => {
  it('denies an agent listing expenses or campaigns', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      getDocs(query(collection(db, 'expenses'), where('orgId', '==', ORG), limit(5))),
    )
    await assertFails(
      getDocs(query(collection(db, 'campaigns'), where('orgId', '==', ORG), limit(5))),
    )
  })

  it('denies a viewer listing expenses or campaigns', async () => {
    const db = await as('viewer1', { role: 'viewer' })
    await assertFails(
      getDocs(query(collection(db, 'expenses'), where('orgId', '==', ORG), limit(5))),
    )
    await assertFails(
      getDocs(query(collection(db, 'campaigns'), where('orgId', '==', ORG), limit(5))),
    )
  })

  it('allows finance and managers', async () => {
    for (const db of [await asFinance(), await asManager()]) {
      await assertSucceeds(
        getDocs(query(collection(db, 'expenses'), where('orgId', '==', ORG), limit(5))),
      )
    }
  })

  it('lets every role list the redacted campaign mirror', async () => {
    for (const db of [await asAgent('agent1'), await as('viewer1', { role: 'viewer' }), await asFinance()]) {
      await assertSucceeds(
        getDocs(query(collection(db, 'campaignsPublic'), where('orgId', '==', ORG), limit(5))),
      )
    }
  })
})
