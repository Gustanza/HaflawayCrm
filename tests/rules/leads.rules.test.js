import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore'
import {
  getTestEnv,
  teardown,
  clearData,
  seed,
  leadDoc,
  ORG,
  OTHER_ORG,
  asAgent,
  asManager,
  asFinance,
  asAdmin,
  asViewer,
  asDeactivated,
  asClaimless,
  asAnonymous,
  assertFails,
  assertSucceeds,
} from './setup.js'

beforeAll(async () => {
  await getTestEnv()
})
afterAll(teardown)
beforeEach(clearData)

// ---------------------------------------------------------------------------
// The floor: nobody unauthenticated or deactivated gets anything.
// ---------------------------------------------------------------------------
describe('baseline access', () => {
  it('denies an anonymous visitor', async () => {
    await seed(`leads/l1`, leadDoc())
    const db = await asAnonymous()
    await assertFails(getDoc(doc(db, 'leads/l1')))
  })

  it('denies a deactivated staff member their own former lead', async () => {
    await seed(`leads/l1`, leadDoc({ ownerId: 'ex-staff' }))
    const db = await asDeactivated()
    await assertFails(getDoc(doc(db, 'leads/l1')))
  })

  it('denies a user whose claims have not been synced yet', async () => {
    await seed(`leads/l1`, leadDoc())
    const db = await asClaimless()
    await assertFails(getDoc(doc(db, 'leads/l1')))
  })

  it('denies access to a collection that no rule mentions', async () => {
    const db = await asAdmin()
    await assertFails(getDoc(doc(db, 'secretStuff/x')))
    await assertFails(setDoc(doc(db, 'secretStuff/x'), { a: 1 }))
  })

  it('denies cross-organisation reads even for an admin', async () => {
    await seed(`leads/l1`, leadDoc({ orgId: OTHER_ORG }))
    const db = await asAdmin()
    await assertFails(getDoc(doc(db, 'leads/l1')))
  })
})

// ---------------------------------------------------------------------------
// Lead visibility — an agent must not see a colleague's pipeline (§7.1).
// ---------------------------------------------------------------------------
describe('lead reads', () => {
  it('lets an agent read their own lead', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'leads/l1')))
  })

  it("denies an agent a colleague's lead", async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent2' }))
    await assertFails(getDoc(doc(await asAgent('agent1'), 'leads/l1')))
  })

  it('lets any agent read an unowned lead from the claimable pool', async () => {
    await seed('leads/l1', leadDoc({ ownerId: null }))
    await assertSucceeds(getDoc(doc(await asAgent('agent9'), 'leads/l1')))
  })

  it('lets a manager read a lead belonging to their team', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent2', teamId: 'team-a' }))
    await assertSucceeds(getDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'leads/l1')))
  })

  it('denies a manager a lead from another team', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent5', teamId: 'team-b' }))
    await assertFails(getDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'leads/l1')))
  })

  it('lets finance, admin and viewer read every lead in the org', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent2', teamId: 'team-z' }))
    await assertSucceeds(getDoc(doc(await asFinance(), 'leads/l1')))
    await assertSucceeds(getDoc(doc(await asAdmin(), 'leads/l1')))
    await assertSucceeds(getDoc(doc(await asViewer(), 'leads/l1')))
  })
})

// ---------------------------------------------------------------------------
// Lead creation
// ---------------------------------------------------------------------------
describe('lead creation', () => {
  function newLead(extra = {}) {
    return {
      ...leadDoc(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...extra,
    }
  }

  it('lets an agent create a lead they own', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(setDoc(doc(db, 'leads/new1'), newLead()))
  })

  it('denies an agent creating a lead owned by someone else', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'leads/new1'), newLead({ ownerId: 'agent2' })),
    )
  })

  it('lets a manager create a lead on behalf of an agent', async () => {
    const db = await asManager('manager1')
    await assertSucceeds(
      setDoc(doc(db, 'leads/new1'), newLead({
        ownerId: 'agent2',
        createdBy: 'manager1',
        updatedBy: 'manager1',
        attribution: { ...leadDoc().attribution, capturedByUserId: 'manager1' },
      })),
    )
  })

  it('denies a viewer creating anything', async () => {
    const db = await asViewer()
    await assertFails(setDoc(doc(db, 'leads/new1'), newLead({
      ownerId: 'viewer1', createdBy: 'viewer1', updatedBy: 'viewer1',
      attribution: { ...leadDoc().attribution, capturedByUserId: 'viewer1' },
    })))
  })

  it('denies a lead that does not start at stage "new"', async () => {
    const db = await asAgent('agent1')
    await assertFails(setDoc(doc(db, 'leads/new1'), newLead({ stage: 'won' })))
  })

  it('denies forging createdBy as another user', async () => {
    const db = await asAgent('agent1')
    await assertFails(setDoc(doc(db, 'leads/new1'), newLead({ createdBy: 'agent2' })))
  })

  it('denies a client-supplied createdAt — timestamps come from the server', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'leads/new1'), { ...leadDoc(), createdAt: new Date('2020-01-01'), updatedAt: serverTimestamp() }),
    )
  })

  it('denies planting a lead into another organisation', async () => {
    const db = await asAgent('agent1')
    await assertFails(setDoc(doc(db, 'leads/new1'), newLead({ orgId: OTHER_ORG })))
  })
})

// ---------------------------------------------------------------------------
// Lead updates — the integrity rules that protect the CAC numbers.
// ---------------------------------------------------------------------------
describe('lead updates', () => {
  const stamp = { updatedAt: serverTimestamp(), updatedBy: 'agent1' }

  beforeEach(async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1', stage: 'new' }))
  })

  it('lets the owner edit their lead', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(updateDoc(doc(db, 'leads/l1'), { displayName: 'Updated', ...stamp }))
  })

  it('denies a non-owner agent editing it', async () => {
    const db = await asAgent('agent2')
    await assertFails(updateDoc(doc(db, 'leads/l1'), { displayName: 'Hijacked', updatedAt: serverTimestamp(), updatedBy: 'agent2' }))
  })

  it('allows a legal stage transition', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(updateDoc(doc(db, 'leads/l1'), { stage: 'contacted', ...stamp }))
  })

  it('blocks skipping the funnel from new straight to won', async () => {
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1'), { stage: 'won', ...stamp }))
  })

  it('blocks reopening a won lead', async () => {
    await seed('leads/l2', leadDoc({ ownerId: 'agent1', stage: 'won' }))
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l2'), { stage: 'negotiation', ...stamp }))
  })

  it('requires a loss reason when losing a lead', async () => {
    await seed('leads/l3', leadDoc({ ownerId: 'agent1', stage: 'quoted' }))
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l3'), { stage: 'lost', closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp }),
    )
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l3'), {
        stage: 'lost', lossReason: 'price', closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })

  it('requires a deal value when winning', async () => {
    await seed('leads/l4', leadDoc({ ownerId: 'agent1', stage: 'quoted' }))
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l4'), { stage: 'won', closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp }),
    )
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l4'), {
        stage: 'won', dealValueMinor: 15000000, closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })

  it('denies closing a lead in someone else\'s name', async () => {
    await seed('leads/l5', leadDoc({ ownerId: 'agent1', stage: 'quoted' }))
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l5'), {
        stage: 'won', dealValueMinor: 15000000, closedAt: serverTimestamp(), closedBy: 'agent2', ...stamp,
      }),
    )
  })

  // ---- The two rules that keep CAC honest ----

  it('denies ANY edit to attribution — it is frozen at creation (P5)', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l1'), {
        attribution: { ...leadDoc().attribution, campaignId: 'a-better-looking-campaign' },
        ...stamp,
      }),
    )
  })

  it('denies an agent reassigning a lead to themselves (anti-poaching)', async () => {
    await seed('leads/l6', leadDoc({ ownerId: 'agent2' }))
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l6'), { ownerId: 'agent1', updatedAt: serverTimestamp(), updatedBy: 'agent1' }),
    )
  })

  it('denies the owner handing their own lead to someone else', async () => {
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1'), { ownerId: 'agent2', ...stamp }))
  })

  it('lets a manager reassign within their team', async () => {
    const db = await asManager('manager1', { teamId: 'team-a' })
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l1'), { ownerId: 'agent2', updatedAt: serverTimestamp(), updatedBy: 'manager1' }),
    )
  })

  it('denies backdating updatedAt', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l1'), { displayName: 'X', updatedAt: new Date('2020-01-01'), updatedBy: 'agent1' }),
    )
  })

  it('denies rewriting createdBy after the fact', async () => {
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1'), { createdBy: 'agent1-the-hero', ...stamp }))
  })

  it('denies hard deletion — soft delete only', async () => {
    const db = await asAdmin()
    await assertFails(deleteDoc(doc(db, 'leads/l1')))
  })
})

// ---------------------------------------------------------------------------
// Activities — append-only. The audit trail that settles commission disputes.
// ---------------------------------------------------------------------------
describe('activities are append-only (P1, P4)', () => {
  beforeEach(async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await seed('leads/l1/activities/a1', {
      type: 'call', at: new Date(), byUserId: 'agent1', outcome: 'no_answer', isVoided: false,
    })
  })

  it('lets the owner append an activity', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      addDoc(collection(db, 'leads/l1/activities'), {
        type: 'call', at: serverTimestamp(), byUserId: 'agent1', outcome: 'spoke', isVoided: false,
      }),
    )
  })

  it('denies appending an activity in someone else\'s name', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      addDoc(collection(db, 'leads/l1/activities'), {
        type: 'call', at: serverTimestamp(), byUserId: 'agent2', outcome: 'spoke', isVoided: false,
      }),
    )
  })

  it('denies creating an activity that is already voided', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      addDoc(collection(db, 'leads/l1/activities'), {
        type: 'call', at: serverTimestamp(), byUserId: 'agent1', isVoided: true,
      }),
    )
  })

  it('denies editing the body of an existing activity', async () => {
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1/activities/a1'), { body: 'rewritten history' }))
  })

  it('denies changing the recorded outcome', async () => {
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1/activities/a1'), { outcome: 'spoke' }))
  })

  it('allows voiding with a stated reason', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: 'logged against the wrong lead',
        voidedAt: serverTimestamp(),
      }),
    )
  })

  it('denies voiding without a reason', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: '', voidedAt: serverTimestamp(),
      }),
    )
  })

  it('denies un-voiding', async () => {
    await seed('leads/l1/activities/a2', {
      type: 'note', at: new Date(), byUserId: 'agent1', isVoided: true, voidedBy: 'agent1', voidReason: 'oops',
    })
    const db = await asAgent('agent1')
    await assertFails(updateDoc(doc(db, 'leads/l1/activities/a2'), { isVoided: false }))
  })

  it('denies deletion to everyone, including admins', async () => {
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1')))
    await assertFails(deleteDoc(doc(await asAdmin(), 'leads/l1/activities/a1')))
  })

  it("denies another agent reading the lead's timeline", async () => {
    const db = await asAgent('agent2')
    await assertFails(getDoc(doc(db, 'leads/l1/activities/a1')))
  })
})

// ---------------------------------------------------------------------------
// Money. The single most important boundary in the system (§7.1).
// ---------------------------------------------------------------------------
describe('cost data is invisible to agents', () => {
  beforeEach(async () => {
    await seed('expenses/e1', {
      orgId: ORG, category: 'salary', amountMinor: 40000000, monthKey: '2026-08',
      allocation: { type: 'staff', staffId: 'agent1' }, enteredBy: 'finance1',
    })
    await seed('campaigns/c1', { orgId: ORG, name: 'IG August', channel: 'instagram', budgetMinor: 50000000 })
    await seed('campaigns/c1/spend/s1', { dayKey: '2026-08-01', amountMinor: 2000000, enteredBy: 'finance1' })
    await seed('rollups/org_2026-08', { orgId: ORG, scope: 'org', cacMinor: 4200000 })
    await seed('rollupsPublic/org_2026-08', { orgId: ORG, scope: 'org', leadsCreated: 120 })
  })

  it('denies an agent reading expenses', async () => {
    await assertFails(getDoc(doc(await asAgent('agent1'), 'expenses/e1')))
  })

  it('denies an agent reading their OWN salary expense', async () => {
    // Even though allocation.staffId is them — payroll is not theirs to browse.
    await assertFails(getDoc(doc(await asAgent('agent1'), 'expenses/e1')))
  })

  it('denies an agent reading campaign budgets or spend', async () => {
    await assertFails(getDoc(doc(await asAgent('agent1'), 'campaigns/c1')))
    await assertFails(getDoc(doc(await asAgent('agent1'), 'campaigns/c1/spend/s1')))
  })

  it('denies an agent reading cost rollups but allows the public volume rollup', async () => {
    await assertFails(getDoc(doc(await asAgent('agent1'), 'rollups/org_2026-08')))
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'rollupsPublic/org_2026-08')))
  })

  it('lets finance and managers read cost data', async () => {
    await assertSucceeds(getDoc(doc(await asFinance(), 'expenses/e1')))
    await assertSucceeds(getDoc(doc(await asManager(), 'expenses/e1')))
  })
})

describe('the financial ledger is append-only (P4)', () => {
  beforeEach(async () => {
    await seed('expenses/e1', {
      orgId: ORG, category: 'ad_spend', amountMinor: 2000000, monthKey: '2026-08',
      allocation: { type: 'campaign', campaignId: 'c1' }, enteredBy: 'finance1',
    })
    await seed('campaigns/c1/spend/s1', { dayKey: '2026-08-01', amountMinor: 2000000, enteredBy: 'finance1' })
  })

  it('lets finance append an expense', async () => {
    const db = await asFinance('finance1')
    await assertSucceeds(
      setDoc(doc(db, 'expenses/e2'), {
        orgId: ORG, category: 'airtime', amountMinor: 500000, monthKey: '2026-08',
        allocation: { type: 'staff', staffId: 'agent1' }, enteredBy: 'finance1',
      }),
    )
  })

  it('denies finance editing an expense — corrections are new documents', async () => {
    const db = await asFinance('finance1')
    await assertFails(updateDoc(doc(db, 'expenses/e1'), { amountMinor: 1 }))
  })

  it('denies even an admin editing or deleting an expense', async () => {
    const db = await asAdmin()
    await assertFails(updateDoc(doc(db, 'expenses/e1'), { amountMinor: 1 }))
    await assertFails(deleteDoc(doc(db, 'expenses/e1')))
  })

  it('denies an agent writing an expense against themselves', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'expenses/e3'), {
        orgId: ORG, category: 'transport', amountMinor: 100000, enteredBy: 'agent1',
        allocation: { type: 'staff', staffId: 'agent1' },
      }),
    )
  })

  it('denies forging enteredBy', async () => {
    const db = await asFinance('finance1')
    await assertFails(
      setDoc(doc(db, 'expenses/e4'), {
        orgId: ORG, category: 'rent', amountMinor: 100000, enteredBy: 'someone-else',
        allocation: { type: 'overhead' },
      }),
    )
  })

  it('denies editing or deleting campaign spend', async () => {
    const db = await asFinance('finance1')
    await assertFails(updateDoc(doc(db, 'campaigns/c1/spend/s1'), { amountMinor: 1 }))
    await assertFails(deleteDoc(doc(db, 'campaigns/c1/spend/s1')))
  })

  it('denies any client writing a rollup — those come from the trusted job only', async () => {
    await assertFails(setDoc(doc(await asAdmin(), 'rollups/org_2026-09'), { cacMinor: 0 }))
    await assertFails(setDoc(doc(await asFinance(), 'rollupsPublic/org_2026-09'), { leadsCreated: 0 }))
  })
})

describe('a locked month cannot be rewritten (§9)', () => {
  it('allows editing an open month', async () => {
    await seed('costAllocationPolicy/2026-08', {
      orgId: ORG, overheadMethod: 'by_revenue', lockedAt: null,
    })
    const db = await asFinance()
    await assertSucceeds(updateDoc(doc(db, 'costAllocationPolicy/2026-08'), { overheadMethod: 'equal' }))
  })

  it('denies editing a locked month, even for finance', async () => {
    await seed('costAllocationPolicy/2026-07', {
      orgId: ORG, overheadMethod: 'by_revenue', lockedAt: new Date('2026-08-01'), lockedBy: 'finance1',
    })
    const db = await asFinance()
    await assertFails(updateDoc(doc(db, 'costAllocationPolicy/2026-07'), { overheadMethod: 'equal' }))
  })

  it('denies deleting a policy to escape the lock', async () => {
    await seed('costAllocationPolicy/2026-07', { orgId: ORG, lockedAt: new Date('2026-08-01') })
    await assertFails(deleteDoc(doc(await asAdmin(), 'costAllocationPolicy/2026-07')))
  })
})

// ---------------------------------------------------------------------------
// Roles and self-promotion
// ---------------------------------------------------------------------------
describe('users cannot promote themselves', () => {
  beforeEach(async () => {
    await seed('users/agent1', {
      orgId: ORG, displayName: 'Neema', role: 'agent', teamId: 'team-a', isActive: true,
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
  })

  it('lets a user edit their own display name and locale', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      updateDoc(doc(db, 'users/agent1'), {
        displayName: 'Neema J.', locale: 'sw', updatedAt: serverTimestamp(), updatedBy: 'agent1',
      }),
    )
  })

  it('denies a user granting themselves the admin role', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'users/agent1'), { role: 'admin', updatedAt: serverTimestamp(), updatedBy: 'agent1' }),
    )
  })

  it('denies a user reactivating themselves', async () => {
    // Seeded separately and genuinely deactivated: writing isActive:true onto a user who
    // is already active is a no-op that changes no keys, and would pass vacuously.
    await seed('users/suspended1', {
      orgId: ORG, displayName: 'Suspended', role: 'agent', teamId: 'team-a', isActive: false,
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
    const db = await asAgent('suspended1')
    await assertFails(
      updateDoc(doc(db, 'users/suspended1'), {
        isActive: true, updatedAt: serverTimestamp(), updatedBy: 'suspended1',
      }),
    )
  })

  it('denies a user moving themselves to another team', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      updateDoc(doc(db, 'users/agent1'), { teamId: 'team-b', updatedAt: serverTimestamp(), updatedBy: 'agent1' }),
    )
  })

  it('denies editing a colleague\'s profile', async () => {
    const db = await asAgent('agent2')
    await assertFails(
      updateDoc(doc(db, 'users/agent1'), { displayName: 'Rude', updatedAt: serverTimestamp(), updatedBy: 'agent2' }),
    )
  })

  it('lets an admin change a role', async () => {
    const db = await asAdmin('admin1')
    await assertSucceeds(
      updateDoc(doc(db, 'users/agent1'), { role: 'manager', updatedAt: serverTimestamp(), updatedBy: 'admin1' }),
    )
  })

  it('denies a manager changing a role', async () => {
    const db = await asManager('manager1')
    await assertFails(
      updateDoc(doc(db, 'users/agent1'), { role: 'admin', updatedAt: serverTimestamp(), updatedBy: 'manager1' }),
    )
  })

  it('denies deleting a user record', async () => {
    await assertFails(deleteDoc(doc(await asAdmin(), 'users/agent1')))
  })
})

// ---------------------------------------------------------------------------
// The dedupe lock (§6.4)
// ---------------------------------------------------------------------------
describe('leadPhoneIndex — the duplicate lock', () => {
  it('lets any active agent check whether a number is taken', async () => {
    const db = await asAgent('agent1')
    // Must resolve (as "not found"), not deny — the quick-add form depends on this.
    await assertSucceeds(getDoc(doc(db, `leadPhoneIndex/${ORG}_+255712345678`)))
  })

  it('lets an agent claim a free number', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      setDoc(doc(db, `leadPhoneIndex/${ORG}_+255712345678`), {
        orgId: ORG, leadId: 'l1', ownerId: 'agent1', createdAt: serverTimestamp(),
      }),
    )
  })

  it('denies an agent overwriting a claim held by a colleague', async () => {
    await seed(`leadPhoneIndex/${ORG}_+255712345678`, { orgId: ORG, leadId: 'l1', ownerId: 'agent2' })
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, `leadPhoneIndex/${ORG}_+255712345678`), {
        orgId: ORG, leadId: 'l9', ownerId: 'agent1',
      }),
    )
  })

  it('denies an agent deleting a claim to free the number up', async () => {
    await seed(`leadPhoneIndex/${ORG}_+255712345678`, { orgId: ORG, leadId: 'l1', ownerId: 'agent2' })
    await assertFails(deleteDoc(doc(await asAgent('agent1'), `leadPhoneIndex/${ORG}_+255712345678`)))
  })

  it('lets a manager reassign a claim', async () => {
    await seed(`leadPhoneIndex/${ORG}_+255712345678`, { orgId: ORG, leadId: 'l1', ownerId: 'agent2' })
    const db = await asManager('manager1')
    await assertSucceeds(
      updateDoc(doc(db, `leadPhoneIndex/${ORG}_+255712345678`), { ownerId: 'agent1' }),
    )
  })
})

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
describe('tasks', () => {
  beforeEach(async () => {
    await seed('tasks/t1', {
      orgId: ORG, ownerId: 'agent1', teamId: 'team-a', leadId: 'l1',
      title: 'Retry call', dueAt: new Date(), status: 'open',
    })
  })

  it('lets the owner read and complete their task', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(getDoc(doc(db, 'tasks/t1')))
    await assertSucceeds(updateDoc(doc(db, 'tasks/t1'), { status: 'done', outcome: 'spoke' }))
  })

  it("denies another agent reading or completing it", async () => {
    const db = await asAgent('agent2')
    await assertFails(getDoc(doc(db, 'tasks/t1')))
    await assertFails(updateDoc(doc(db, 'tasks/t1'), { status: 'done' }))
  })

  it('lets a manager see their team\'s tasks', async () => {
    await assertSucceeds(getDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'tasks/t1')))
  })

  it('denies an agent assigning work to a colleague', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'tasks/t2'), {
        orgId: ORG, ownerId: 'agent2', teamId: 'team-a', title: 'You do it', status: 'open',
      }),
    )
  })

  it('lets a manager assign work', async () => {
    const db = await asManager('manager1')
    await assertSucceeds(
      setDoc(doc(db, 'tasks/t3'), {
        orgId: ORG, ownerId: 'agent1', teamId: 'team-a', title: 'Chase this', status: 'open',
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
describe('audit log', () => {
  it('is readable by admins only and writable by nobody', async () => {
    await seed('auditLogs/x1', {
      orgId: ORG, actorId: 'agent1', action: 'lead.reassign', at: new Date(),
    })
    await assertSucceeds(getDoc(doc(await asAdmin(), 'auditLogs/x1')))
    await assertFails(getDoc(doc(await asManager(), 'auditLogs/x1')))
    await assertFails(setDoc(doc(await asAdmin(), 'auditLogs/x2'), { actorId: 'admin1' }))
  })
})
