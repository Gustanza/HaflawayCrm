/**
 * `leads/{leadId}/activities` — append-only contact log. TODO.md §3/§4.
 *
 * Mirrors the legacy plan's append-only pattern: `create` is allowed, `update` may only set
 * `isVoided` plus a reason, and `delete` is admin-cascade-only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import {
  getTestEnv, teardown, clearData, seed, leadDoc, activityDoc, ORG,
  asAgent, asManager, asAdmin, assertFails, assertSucceeds,
} from './setup.js'

beforeAll(async () => { await getTestEnv() })
afterAll(teardown)
beforeEach(clearData)

describe('creating an activity', () => {
  it('the lead owner can log a contact', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertSucceeds(
      setDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), activityDoc({
        byUserId: 'agent1', at: serverTimestamp(),
      })),
    )
  })

  it('cannot log an activity under someone else\'s uid', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      setDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), activityDoc({
        byUserId: 'agent2', at: serverTimestamp(),
      })),
    )
  })

  it('cannot backdate `at`', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      setDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), activityDoc({
        byUserId: 'agent1', at: new Date('2020-01-01'),
      })),
    )
  })

  it('someone who cannot write the lead cannot log against it', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await assertFails(
      setDoc(doc(await asAgent('agent2'), 'leads/l1/activities/a1'), activityDoc({
        byUserId: 'agent2', at: serverTimestamp(),
      })),
    )
  })
})

describe('the timeline is append-only', () => {
  it('cannot edit the summary or outcome after the fact', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await seed('leads/l1/activities/a1', activityDoc())
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), { summary: 'edited' }),
    )
  })

  it('a correction may only set isVoided plus a reason', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await seed('leads/l1/activities/a1', activityDoc())
    await assertSucceeds(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: 'logged against the wrong lead',
        voidedAt: serverTimestamp(),
      }),
    )
  })

  it('a void without a reason is rejected', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await seed('leads/l1/activities/a1', activityDoc())
    await assertFails(
      updateDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1'), {
        isVoided: true, voidedBy: 'agent1', voidReason: '', voidedAt: serverTimestamp(),
      }),
    )
  })

  it('nobody but an admin can delete an activity', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'agent1' }))
    await seed('leads/l1/activities/a1', activityDoc())
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1')))
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1/activities/a1')))
  })
})
