/**
 * Cross-organisation isolation.
 *
 * These exist because an adversarial review found 28 breaches that the original 78-test
 * suite could not see: it only ever tested cross-org on `leads`, so every money and
 * control-plane collection was gated on ROLE ALONE. A finance or manager account in a
 * different organisation could read this org's budgets, spend and cost policy — and
 * rewrite them.
 *
 * TODO.md §6.1 says "one org today, cheap multi-tenancy tomorrow", so none of this was a
 * live breach. It was a loaded gun pointed at the day we add a second org, and the intent
 * was already in the rules for leads. Every collection now carries the check, and every
 * collection now has a test that would notice if it were removed.
 */
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import {
  getTestEnv,
  teardown,
  clearData,
  seed,
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
beforeEach(clearData)

/** Fully-privileged accounts — but in a DIFFERENT organisation. */
const rivalFinance = () => as('rival-finance', { role: 'finance', orgId: OTHER_ORG })
const rivalManager = () => as('rival-manager', { role: 'manager', orgId: OTHER_ORG })
const rivalAdmin = () => as('rival-admin', { role: 'admin', orgId: OTHER_ORG })
const rivalAgent = () => as('rival-agent', { role: 'agent', orgId: OTHER_ORG })

describe('money is invisible across organisations', () => {
  beforeEach(async () => {
    await seed('expenses/e1', {
      orgId: ORG, category: 'salary', amountMinor: 40000000, monthKey: '2026-08',
      allocation: { type: 'staff', staffId: 'agent1' }, enteredBy: 'finance1',
    })
    await seed('campaigns/c1', {
      orgId: ORG, name: 'IG August', channel: 'instagram', budgetMinor: 50000000,
      createdAt: new Date(), createdBy: 'finance1', updatedAt: new Date(), updatedBy: 'finance1',
    })
    await seed('campaigns/c1/spend/s1', { dayKey: '2026-08-01', amountMinor: 2000000, enteredBy: 'finance1' })
    await seed('rollups/org_2026-08', { orgId: ORG, scope: 'org', cacMinor: 4200000 })
    await seed('costAllocationPolicy/2026-08', {
      orgId: ORG, overheadMethod: 'by_revenue', lockedAt: null,
    })
  })

  it('denies a rival finance account reading expenses', async () => {
    await assertFails(getDoc(doc(await rivalFinance(), 'expenses/e1')))
  })

  it('denies a rival manager reading expenses', async () => {
    await assertFails(getDoc(doc(await rivalManager(), 'expenses/e1')))
  })

  it('denies a rival reading campaign budgets or spend', async () => {
    await assertFails(getDoc(doc(await rivalManager(), 'campaigns/c1')))
    await assertFails(getDoc(doc(await rivalFinance(), 'campaigns/c1/spend/s1')))
  })

  it('denies a rival reading cost rollups', async () => {
    await assertFails(getDoc(doc(await rivalManager(), 'rollups/org_2026-08')))
  })

  it('denies a rival reading OR rewriting the cost allocation policy', async () => {
    const db = await rivalFinance()
    await assertFails(getDoc(doc(db, 'costAllocationPolicy/2026-08')))
    await assertFails(updateDoc(doc(db, 'costAllocationPolicy/2026-08'), { overheadMethod: 'equal' }))
  })

  it('denies a rival appending spend to our campaign', async () => {
    await assertFails(
      setDoc(doc(await rivalFinance(), 'campaigns/c1/spend/s2'), {
        dayKey: '2026-08-02', amountMinor: 99999999, enteredBy: 'rival-finance',
      }),
    )
  })

  it('denies a rival overwriting the public campaign mirror', async () => {
    await seed('campaignsPublic/c1', { orgId: ORG, name: 'IG August', channel: 'instagram' })
    await assertFails(
      setDoc(doc(await rivalFinance(), 'campaignsPublic/c1'), {
        orgId: OTHER_ORG, name: 'Hijacked', channel: 'facebook',
      }),
    )
  })

  it('still lets OUR finance do all of the above', async () => {
    const db = await asFinance()
    await assertSucceeds(getDoc(doc(db, 'expenses/e1')))
    await assertSucceeds(getDoc(doc(db, 'campaigns/c1')))
    await assertSucceeds(getDoc(doc(db, 'campaigns/c1/spend/s1')))
    await assertSucceeds(getDoc(doc(db, 'costAllocationPolicy/2026-08')))
    await assertSucceeds(
      updateDoc(doc(db, 'costAllocationPolicy/2026-08'), { overheadMethod: 'equal' }),
    )
  })
})

describe('the control plane is organisation-scoped', () => {
  it('denies a rival reading or writing settings', async () => {
    await seed('settings/org', { orgId: ORG, name: 'Haflaway', currency: 'TZS' })
    await assertFails(getDoc(doc(await rivalAgent(), 'settings/org')))
    await assertFails(setDoc(doc(await rivalAdmin(), 'settings/org'), { orgId: OTHER_ORG }))
    await assertSucceeds(getDoc(doc(await asAgent(), 'settings/org')))
  })

  it('denies a rival manager pushing a notification to our staff', async () => {
    // Otherwise this is a phishing channel inside the product.
    await seed('users/agent1', {
      orgId: ORG, displayName: 'Zawadi', role: 'agent', teamId: 'team-a', isActive: true,
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
    await assertFails(
      setDoc(doc(await rivalManager(), 'notifications/agent1/items/n1'), {
        orgId: OTHER_ORG, type: 'alert', title: 'Click here', isRead: false,
      }),
    )
  })

  it('denies a rival reading the audit log', async () => {
    await seed('auditLogs/x1', { orgId: ORG, actorId: 'agent1', action: 'lead.reassign', at: new Date() })
    await assertFails(getDoc(doc(await rivalAdmin(), 'auditLogs/x1')))
    await assertSucceeds(getDoc(doc(await asAdmin(), 'auditLogs/x1')))
  })

  it('denies a rival reading import jobs', async () => {
    await seed('importJobs/j1', {
      orgId: ORG, fileName: 'leads.csv', status: 'done',
      createdAt: new Date(), createdBy: 'manager1', updatedAt: new Date(), updatedBy: 'manager1',
    })
    await assertFails(getDoc(doc(await rivalManager(), 'importJobs/j1')))
  })

  it('denies a manager deleting a task from another team', async () => {
    await seed('tasks/t1', {
      orgId: ORG, ownerId: 'agent5', teamId: 'team-b', leadId: 'l1', title: 'x', status: 'open',
    })
    await assertFails(deleteDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'tasks/t1')))
    await assertSucceeds(deleteDoc(doc(await asManager('manager-b', { teamId: 'team-b' }), 'tasks/t1')))
  })
})

describe('leadPhoneIndex is confined to one organisation', () => {
  const KEY = `leadPhoneIndex/${ORG}_+255712345678`

  it('denies a rival reading our claim', async () => {
    await seed(KEY, { orgId: ORG, leadId: 'l1', ownerId: 'agent1' })
    await assertFails(getDoc(doc(await rivalAgent(), KEY)))
  })

  it('denies a rival stealing or deleting our claim', async () => {
    await seed(KEY, { orgId: ORG, leadId: 'l1', ownerId: 'agent1' })
    await assertFails(updateDoc(doc(await rivalManager(), KEY), { ownerId: 'rival-agent' }))
    await assertFails(deleteDoc(doc(await rivalAdmin(), KEY)))
  })

  it('does not let one org block another from capturing the same number', async () => {
    // The whole reason for the org prefix: two organisations must be able to hold the
    // same phone number without colliding.
    await seed(KEY, { orgId: ORG, leadId: 'l1', ownerId: 'agent1' })
    await assertSucceeds(
      setDoc(doc(await rivalAgent(), `leadPhoneIndex/${OTHER_ORG}_+255712345678`), {
        orgId: OTHER_ORG, leadId: 'r1', ownerId: 'rival-agent', createdAt: serverTimestamp(),
      }),
    )
  })

  it('denies an agent claiming a number in someone else name', async () => {
    await assertFails(
      setDoc(doc(await asAgent('agent1'), KEY), {
        orgId: ORG, leadId: 'l1', ownerId: 'agent2', createdAt: serverTimestamp(),
      }),
    )
  })

  it('denies writing an entry under a forged org prefix', async () => {
    await assertFails(
      setDoc(doc(await asAgent('agent1'), `leadPhoneIndex/${OTHER_ORG}_+255712345678`), {
        orgId: OTHER_ORG, leadId: 'l1', ownerId: 'agent1', createdAt: serverTimestamp(),
      }),
    )
  })
})

describe('agents cannot read a colleague pay data', () => {
  beforeEach(async () => {
    await seed('users/manager1', {
      orgId: ORG, displayName: 'Neema', role: 'manager', teamId: 'team-a', isActive: true,
      phone: '+255712000001',
      commissionRatePct: 7.5,
      targets: { monthlyRevenueMinor: 900000000 },
      fcmTokens: ['secret-device-token'],
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
  })

  it('denies an agent reading a colleague full user document', async () => {
    // Firestore cannot project fields, so `allow read` hands over commissionRatePct,
    // targets, phone and FCM tokens along with the display name.
    await assertFails(getDoc(doc(await asAgent('agent1'), 'users/manager1')))
  })

  it('still lets an agent read their own document', async () => {
    await seed('users/agent1', {
      orgId: ORG, displayName: 'Zawadi', role: 'agent', teamId: 'team-a', isActive: true,
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'users/agent1')))
  })

  it('lets managers, finance and admin read colleagues', async () => {
    await assertSucceeds(getDoc(doc(await asManager('manager9'), 'users/manager1')))
    await assertSucceeds(getDoc(doc(await asFinance(), 'users/manager1')))
    await assertSucceeds(getDoc(doc(await asAdmin(), 'users/manager1')))
  })

  it('gives agents a redacted mirror for lead-list display names', async () => {
    await seed('usersPublic/manager1', { orgId: ORG, displayName: 'Neema', photoPath: null })
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'usersPublic/manager1')))
    await assertFails(getDoc(doc(await rivalAgent(), 'usersPublic/manager1')))
  })
})

describe('the server enforces the §5.2 closure invariants', () => {
  const stamp = { updatedAt: serverTimestamp(), updatedBy: 'agent1' }

  beforeEach(async () => {
    await seed('leads/l1', {
      orgId: ORG, ownerId: 'agent1', teamId: 'team-a', stage: 'quoted', leadStatus: 'open',
      displayName: 'Test', attribution: { model: 'first_touch', capturedByUserId: 'agent1' },
      createdAt: new Date(), createdBy: 'agent1', updatedAt: new Date(), updatedBy: 'agent1',
    })
  })

  it('refuses a win worth zero', async () => {
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        stage: 'won', dealValueMinor: 0, closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })

  it('refuses a win worth a NEGATIVE amount', async () => {
    // This would silently drag every revenue and CAC figure in the period downwards.
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        stage: 'won', dealValueMinor: -50000000, closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })

  it('refuses a loss with an empty reason string', async () => {
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        stage: 'lost', lossReason: '', closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })

  it('accepts a properly-formed win and loss', async () => {
    await assertSucceeds(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        stage: 'won', dealValueMinor: 15000000, closedAt: serverTimestamp(), closedBy: 'agent1', ...stamp,
      }),
    )
  })
})

describe('a void cannot be backdated', () => {
  it('pins voidedAt to the server clock', async () => {
    await seed('leads/l1', {
      orgId: ORG, ownerId: 'agent1', teamId: 'team-a', stage: 'new', displayName: 'T',
      attribution: { model: 'first_touch', capturedByUserId: 'agent1' },
      createdAt: new Date(), createdBy: 'agent1', updatedAt: new Date(), updatedBy: 'agent1',
    })
    await seed('leads/l1/activities/a1', {
      type: 'call', at: new Date(), byUserId: 'agent1', outcome: 'no_answer', isVoided: false,
    })
    const db = await asAgent('agent1')

    await assertFails(
      updateDoc(doc(db, 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: 'wrong lead',
        voidedAt: new Date('2020-01-01'),
      }),
    )
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: 'wrong lead',
        voidedAt: serverTimestamp(),
      }),
    )
  })
})

describe('viewer is the lowest-privilege role, not a super-reader', () => {
  // A round-4 audit found `viewer` reading colleagues' commission rates and FCM tokens,
  // and campaign budgets — the opposite of what the role means. `auth.js` already
  // reported `can.viewCosts === false` for viewer; the rules were the side that was wrong.
  it('cannot read a colleague full user document', async () => {
    await seed('users/manager1', {
      orgId: ORG, displayName: 'Neema', role: 'manager', teamId: 'team-a', isActive: true,
      commissionRatePct: 7.5, fcmTokens: ['secret-device-token'],
      createdAt: new Date(), createdBy: 'admin1', updatedAt: new Date(), updatedBy: 'admin1',
    })
    await assertFails(getDoc(doc(await as('viewer1', { role: 'viewer' }), 'users/manager1')))
  })

  it('cannot read campaign budgets, only the public mirror', async () => {
    await seed('campaigns/c1', {
      orgId: ORG, name: 'IG August', channel: 'instagram', budgetMinor: 50000000,
      createdAt: new Date(), createdBy: 'finance1', updatedAt: new Date(), updatedBy: 'finance1',
    })
    await seed('campaignsPublic/c1', { orgId: ORG, name: 'IG August', channel: 'instagram' })
    const db = await as('viewer1', { role: 'viewer' })
    await assertFails(getDoc(doc(db, 'campaigns/c1')))
    await assertSucceeds(getDoc(doc(db, 'campaignsPublic/c1')))
  })

  it('can still read leads, which is the whole point of the role', async () => {
    await seed('leads/l1', {
      orgId: ORG, ownerId: 'agent2', teamId: 'team-z', stage: 'new', displayName: 'T',
      attribution: { model: 'first_touch', capturedByUserId: 'agent2' },
      createdAt: new Date(), createdBy: 'agent2', updatedAt: new Date(), updatedBy: 'agent2',
    })
    await assertSucceeds(getDoc(doc(await as('viewer1', { role: 'viewer' }), 'leads/l1')))
  })
})
