/**
 * `leads` collection — ownership, team scoping, reassignment. TODO.md §4.
 *
 * There is no pipeline stage in this model; what these rules protect is WHO can read/write
 * a lead (owner, their manager, or an admin) and that reassignment (`ownerId`) is gated to
 * manager/admin, mirroring the legacy anti-poaching rule.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import {
  getTestEnv, teardown, clearData, seed, leadDoc, ORG, OTHER_ORG,
  asAgent, asManager, asAdmin, asAnonymous, assertFails, assertSucceeds,
} from './setup.js'

beforeAll(async () => { await getTestEnv() })
afterAll(teardown)
beforeEach(clearData)

describe('reading a lead', () => {
  it('the owner can read their own lead', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertSucceeds(getDoc(doc(await asAgent('agent1'), 'leads/l1')))
  })

  it('a different agent cannot read someone else\'s lead', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(getDoc(doc(await asAgent('agent2'), 'leads/l1')))
  })

  it('an unowned lead is readable by any active agent (the claimable pool)', async () => {
    await seed('leads/l1', leadDoc({ ownerId: null }))
    await assertSucceeds(getDoc(doc(await asAgent('agent2'), 'leads/l1')))
  })

  it('a manager can read any lead on their team, but not another team\'s', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1', teamId: 'team-a' }))
    await seed('leads/l2', leadDoc({ ownerId: 'agent9', teamId: 'team-b' }))
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    await assertSucceeds(getDoc(doc(mgr, 'leads/l1')))
    await assertFails(getDoc(doc(mgr, 'leads/l2')))
  })

  it('an admin can read any lead in the org', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1', teamId: 'team-z' }))
    await assertSucceeds(getDoc(doc(await asAdmin(), 'leads/l1')))
  })

  it('a lead from another org is never readable', async () => {
    await seed('leads/l1', leadDoc({ orgId: OTHER_ORG, ownerId: 'agent1' }))
    await assertFails(getDoc(doc(await asAgent('agent1'), 'leads/l1')))
  })

  it('signed-out is denied', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(getDoc(doc(await asAnonymous(), 'leads/l1')))
  })
})

describe('creating a lead', () => {
  it('an agent may create a lead owned by themselves', async () => {
    const db = await asAgent('agent1')
    await assertSucceeds(
      setDoc(doc(db, 'leads/new1'), leadDoc({
        ownerId: 'agent1', createdBy: 'agent1', updatedBy: 'agent1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })

  it('an agent may NOT create a lead owned by someone else', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'leads/new1'), leadDoc({
        ownerId: 'agent2', createdBy: 'agent1', updatedBy: 'agent1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })

  it('a manager may create a lead on behalf of someone else', async () => {
    const db = await asManager('manager1')
    await assertSucceeds(
      setDoc(doc(db, 'leads/new1'), leadDoc({
        ownerId: 'agent1', createdBy: 'manager1', updatedBy: 'manager1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })

  it('rejects a create stamped with someone else\'s uid', async () => {
    const db = await asAgent('agent1')
    await assertFails(
      setDoc(doc(db, 'leads/new1'), leadDoc({
        ownerId: 'agent1', createdBy: 'agent2', updatedBy: 'agent1',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })),
    )
  })
})

describe('updating a lead', () => {
  it('the owner can update their own lead', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertSucceeds(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        isHot: true, updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('an agent cannot reassign a lead\'s owner', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1'), {
        ownerId: 'agent2', updatedBy: 'agent1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('a manager can reassign a lead within their team', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1', teamId: 'team-a' }))
    const mgr = await asManager('manager1', { teamId: 'team-a' })
    await assertSucceeds(
      updateDoc(doc(mgr, 'leads/l1'), {
        ownerId: 'agent2', previousOwnerIds: ['agent1'],
        updatedBy: 'manager1', updatedAt: serverTimestamp(),
      }),
    )
  })

  it('orgId can never change on update', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      updateDoc(doc(await asAdmin(), 'leads/l1'), {
        orgId: OTHER_ORG, updatedBy: 'admin1', updatedAt: serverTimestamp(),
      }),
    )
  })
})

describe('deleting a lead', () => {
  it('only an admin can hard-delete a lead', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1')))
    await assertFails(deleteDoc(doc(await asManager('manager1', { teamId: 'team-a' }), 'leads/l1')))
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1')))
  })
})
