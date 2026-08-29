/**
 * The hard delete, at the rules layer — TODO.md P10: every `allow` gets a positive and a
 * negative test, and this `allow` destroys data.
 *
 * The client orchestration lives in tests/unit/delete-lead.test.js. What is proved here is
 * that the SERVER agrees: nobody below admin can delete anything, no admin can reach across
 * organisations, the append-only guarantees still hold for everyone who is not deleting the
 * whole lead, and the tombstone cannot be rewritten to hide who did it.
 */
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
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
  asAdmin,
  asViewer,
  assertFails,
  assertSucceeds,
} from './setup.js'

beforeAll(async () => {
  await getTestEnv()
})
afterAll(teardown)
beforeEach(clearData)

const ACTIVITY = {
  type: 'call',
  at: new Date('2026-08-24T09:00:00Z'),
  byUserId: 'agent1',
  body: 'Spoke about the venue',
  isVoided: false,
}

describe('deleting the lead document', () => {
  beforeEach(async () => {
    await seed('leads/l1', leadDoc())
  })

  it('an admin in the same org may delete', async () => {
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1')))
  })

  it('a manager may not — reassigning is not erasing', async () => {
    await assertFails(deleteDoc(doc(await asManager(), 'leads/l1')))
  })

  it('the owning agent may not delete their own lead', async () => {
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1')))
  })

  it('a viewer may not', async () => {
    await assertFails(deleteDoc(doc(await asViewer(), 'leads/l1')))
  })

  it('an admin of ANOTHER organisation may not', async () => {
    const rival = await asAdmin('rival', { orgId: OTHER_ORG })
    await assertFails(deleteDoc(doc(rival, 'leads/l1')))
  })
})

describe('deleting the timeline underneath it', () => {
  beforeEach(async () => {
    await seed('leads/l1', leadDoc())
    await seed('leads/l1/activities/a1', ACTIVITY)
  })

  it('an admin may, as part of destroying the lead', async () => {
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1/activities/a1')))
  })

  it('the agent who wrote it still may not — P1 append-only holds for everyone else', async () => {
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1/activities/a1')))
  })

  it('a manager may not', async () => {
    await assertFails(deleteDoc(doc(await asManager(), 'leads/l1/activities/a1')))
  })

  it("a rival org's admin may not, even knowing the path", async () => {
    const rival = await asAdmin('rival', { orgId: OTHER_ORG })
    await assertFails(deleteDoc(doc(rival, 'leads/l1/activities/a1')))
  })
})

describe('why the lead document must be deleted LAST', () => {
  it('an orphaned activity can no longer be deleted by anyone once its lead is gone', async () => {
    // The child rule is gated on the parent existing and being in your org, because an
    // activity carries no orgId of its own. Delete the parent first and this is what you
    // are left with: a document nothing in the system can ever remove.
    await seed('leads/l1/activities/a1', ACTIVITY)
    await assertFails(deleteDoc(doc(await asAdmin(), 'leads/l1/activities/a1')))
  })
})

describe('quotes', () => {
  beforeEach(async () => {
    await seed('leads/l1', leadDoc())
    await seed('leads/l1/quotes/q1', { status: 'sent', totalMinor: 500000 })
  })

  it('a sent quote is still protected from the agent who sent it', async () => {
    await assertFails(deleteDoc(doc(await asAgent('agent1'), 'leads/l1/quotes/q1')))
  })

  it('but an admin may remove it as part of the cascade', async () => {
    await assertSucceeds(deleteDoc(doc(await asAdmin(), 'leads/l1/quotes/q1')))
  })
})

describe('releasing the phone lock', () => {
  const KEY = `leadPhoneIndex/${ORG}_+255712345678`

  beforeEach(async () => {
    await seed(KEY, { orgId: ORG, leadId: 'l1', ownerId: 'agent1' })
  })

  it('an admin may release it, so the number can be captured again', async () => {
    await assertSucceeds(deleteDoc(doc(await asAdmin(), KEY)))
  })

  it('an agent may not — that would unlock a number another agent holds', async () => {
    await assertFails(deleteDoc(doc(await asAgent('agent1'), KEY)))
  })
})

describe('the tombstone is an audit record, not a note', () => {
  const TOMB = 'leadDeletions/l1'
  const record = (overrides = {}) => ({
    leadId: 'l1',
    orgId: ORG,
    deletedBy: 'admin1',
    deletedAt: serverTimestamp(),
    reason: 'duplicate record',
    stage: 'won',
    phoneReleased: false,
    removed: {},
    completedAt: null,
    ...overrides,
  })

  it('an admin may write one', async () => {
    await assertSucceeds(setDoc(doc(await asAdmin('admin1'), TOMB), record()))
  })

  it('cannot be written without a reason', async () => {
    await assertFails(setDoc(doc(await asAdmin('admin1'), TOMB), record({ reason: '' })))
  })

  it('cannot be attributed to someone else', async () => {
    await assertFails(setDoc(doc(await asAdmin('admin1'), TOMB), record({ deletedBy: 'admin2' })))
  })

  it('cannot be filed under a different lead id than its key', async () => {
    await assertFails(setDoc(doc(await asAdmin('admin1'), TOMB), record({ leadId: 'l9' })))
  })

  it('a manager may neither write nor read one', async () => {
    await assertFails(setDoc(doc(await asManager(), TOMB), record({ deletedBy: 'manager1' })))
  })

  describe('once written', () => {
    beforeEach(async () => {
      await seed(TOMB, { ...record(), deletedAt: new Date('2026-08-24T09:00:00Z') })
    })

    it('may be completed with the outcome', async () => {
      await assertSucceeds(
        updateDoc(doc(await asAdmin(), TOMB), {
          removed: { activities: 4 },
          phoneReleased: true,
          completedAt: serverTimestamp(),
        }),
      )
    })

    it('may NOT have its reason rewritten afterwards', async () => {
      await assertFails(updateDoc(doc(await asAdmin(), TOMB), { reason: 'something else' }))
    })

    it('may NOT have the actor rewritten', async () => {
      await assertFails(updateDoc(doc(await asAdmin(), TOMB), { deletedBy: 'someone-else' }))
    })

    it('may never be deleted — it has to outlive the argument it settles', async () => {
      await assertFails(deleteDoc(doc(await asAdmin(), TOMB)))
    })

    it('is invisible to another organisation', async () => {
      const rival = await asAdmin('rival', { orgId: OTHER_ORG })
      await assertFails(updateDoc(doc(rival, TOMB), { phoneReleased: true }))
    })
  })
})
