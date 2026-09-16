/**
 * `leads/{leadId}/deals` — per-product close state. TODO.md §3/§4.
 *
 * The load-bearing invariant: closing a deal stamps `closedAt`/`closedBy` from the server,
 * and `closed_lost` requires a non-empty `lostReason`. Reopening a closed deal is
 * manager/admin only, mirroring the lead-reassignment anti-poaching gate.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import {
  getTestEnv, teardown, clearData, seed, leadDoc, dealDoc, ORG,
  asAgent, asManager, asAdmin, assertFails, assertSucceeds,
} from './setup.js'

beforeAll(async () => { await getTestEnv() })
afterAll(teardown)
beforeEach(clearData)

async function seedLeadAndDeal(dealOverrides = {}) {
  await seed('leads/l1', leadDoc({ ownerId: 'agent1', teamId: 'team-a' }))
  await seed('leads/l1/deals/d1', dealDoc(dealOverrides))
}

describe('reading deals', () => {
  it('the lead owner can read its deals', async () => {
    await seedLeadAndDeal()
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1')))
  })

  it('a different agent cannot read another agent\'s lead\'s deals', async () => {
    await seedLeadAndDeal()
    await assertFails(getDoc(doc(await asAgent('agent2'), 'leads/l1/deals/d1')))
  })

  it('a manager on the same team can read it', async () => {
    await seedLeadAndDeal()
    await assertSucceeds(getDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'leads/l1/deals/d1')))
  })
})

describe('creating a deal', () => {
  it('the lead owner can add a new open deal', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertSucceeds(
      setDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), dealDoc({
        status: 'open', createdBy: 'agent1', updatedBy: 'agent1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })

  it('cannot create a deal already closed', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      setDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), dealDoc({
        status: 'closed_won', createdBy: 'agent1', updatedBy: 'agent1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })

  it('someone who does not own the lead cannot add a deal to it', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      setDoc(doc(await asAgent('agent2'), 'leads/l1/deals/d1'), dealDoc({
        createdBy: 'agent2', updatedBy: 'agent2',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })
})

describe('closing a deal', () => {
  it('closing won requires the server timestamp and the actor\'s own uid', async () => {
    await seedLeadAndDeal()
    const db = await asAgent('agent1')
    await assertSucceeds(
      updateDoc(doc(db, 'leads/l1/deals/d1'), {
        status: 'closed_won', closedAt: serverTimestamp(), closedBy: 'agent1',
        updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot forge closedBy as someone else', async () => {
    await seedLeadAndDeal()
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), {
        status: 'closed_won', closedAt: serverTimestamp(), closedBy: 'agent2',
        updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('closing lost without a lostReason is rejected', async () => {
    await seedLeadAndDeal()
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), {
        status: 'closed_lost', closedAt: serverTimestamp(), closedBy: 'agent1',
        updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('closing lost with a reason succeeds', async () => {
    await seedLeadAndDeal()
    await assertSucceeds(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), {
        status: 'closed_lost', closedAt: serverTimestamp(), closedBy: 'agent1',
        lostReason: 'no_budget', updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('an agent cannot reopen a closed deal', async () => {
    await seedLeadAndDeal({ status: 'closed_won', closedBy: 'agent1' })
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1'), {
        status: 'open', updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('a manager CAN reopen a closed deal', async () => {
    await seedLeadAndDeal({ status: 'closed_won', closedBy: 'agent1' })
    await assertSucceeds(
      updateDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'leads/l1/deals/d1'), {
        status: 'open', updatedBy: 'manager1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('deals never have a delete route except the admin cascade', async () => {
    await seedLeadAndDeal()
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1/deals/d1')))
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1/deals/d1')))
  })
})
