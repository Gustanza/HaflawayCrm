/**
 * The REAL query builders, against the REAL emulator, as each REAL role.
 *
 * This is the test that proves the screens have data. `tests/rules/list.rules.test.js`
 * proves the rules accept a correctly-shaped query; this proves `src/services/queries.js`
 * actually produces that shape — which is the part a hand-written screen gets wrong.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDocs } from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '@/firebase/app.js'
import {
  leadsQuery,
  urgencyBoardQuery,
  unownedLeadsQuery,
  tasksQuery,
  campaignOptionsQuery,
  expensesQuery,
  campaignsQuery,
} from '@/services/queries.js'

const PASSWORD = 'haflaway123'
const ORG = 'haflaway'

async function signInAs(email) {
  const credential = await signInWithEmailAndPassword(auth, email, PASSWORD)
  const token = await credential.user.getIdTokenResult(true)
  return {
    uid: credential.user.uid,
    role: token.claims.role,
    orgId: token.claims.orgId,
    teamId: token.claims.teamId,
  }
}

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

describe('an agent home screen has data', () => {
  let user

  beforeAll(async () => {
    user = await signInAs('agent1@haflaway.com')
  })

  it('the work queue query returns their open leads', async () => {
    const snap = await getDocs(await leadsQuery(user, { leadStatus: 'open', max: 100 }))
    expect(snap.empty, 'agent1 has no open leads — reseed').toBe(false)
    for (const d of snap.docs) {
      expect(d.data().ownerId).toBe(user.uid)
      expect(d.data().leadStatus).toBe('open')
      expect(d.data().orgId).toBe(ORG)
    }
  })

  it('the lead list query returns their leads', async () => {
    const snap = await getDocs(await leadsQuery(user, { max: 100 }))
    expect(snap.empty).toBe(false)
    for (const d of snap.docs) expect(d.data().ownerId).toBe(user.uid)
  })

  it('the urgency board query returns open leads and is orderable by event date', async () => {
    const snap = await getDocs(await urgencyBoardQuery(user, { max: 50 }))
    expect(snap.empty).toBe(false)

    // The composite index must exist, or this throws "The query requires an index".
    const dates = snap.docs.map((d) => d.data().eventDate?.toMillis?.() ?? 0)
    const sorted = [...dates].sort((a, b) => a - b)
    expect(dates).toEqual(sorted)
  })

  it('the claimable pool query is allowed', async () => {
    await expect(getDocs(await unownedLeadsQuery(user))).resolves.toBeDefined()
  })

  it('the task query is allowed', async () => {
    await expect(getDocs(await tasksQuery(user))).resolves.toBeDefined()
  })

  it('campaign options come from the REDACTED mirror and carry no budget', async () => {
    const snap = await getDocs(await campaignOptionsQuery(user))
    expect(snap.empty).toBe(false)
    for (const d of snap.docs) {
      expect(d.data().name).toBeTruthy()
      // §7.1: an agent must never see a budget.
      expect(d.data().budgetMinor).toBeUndefined()
    }
  })

  it('refuses to even build a cost query for an agent', async () => {
    // Fails loudly in the service layer rather than as an opaque rules error at runtime.
    // These builders are async, so the refusal arrives as a rejection.
    await expect(expensesQuery(user)).rejects.toThrow(/may not read cost data/i)
    await expect(campaignsQuery(user)).rejects.toThrow(/may not read cost data/i)
  })
})

describe('a manager sees their team', () => {
  let user

  beforeAll(async () => {
    await signOut(auth)
    user = await signInAs('manager.dar@haflaway.com')
  })

  it('the lead list query returns the whole team, not just their own', async () => {
    const snap = await getDocs(await leadsQuery(user, { max: 100 }))
    expect(snap.empty).toBe(false)

    const owners = new Set(snap.docs.map((d) => d.data().ownerId))
    expect(owners.size, 'a manager should see more than one owner').toBeGreaterThan(1)
    for (const d of snap.docs) expect(d.data().teamId).toBe(user.teamId)
  })

  it('can scope down to just their own pipeline', async () => {
    const snap = await getDocs(await leadsQuery(user, { scope: 'mine', max: 20 }))
    for (const d of snap.docs) expect(d.data().ownerId).toBe(user.uid)
  })

  it('can read cost data', async () => {
    await expect(getDocs(await expensesQuery(user))).resolves.toBeDefined()
    await expect(getDocs(await campaignsQuery(user))).resolves.toBeDefined()
  })
})

describe('finance and admin see the whole organisation', () => {
  it('finance lists every lead and every expense', async () => {
    await signOut(auth)
    const user = await signInAs('finance@haflaway.com')

    const leads = await getDocs(await leadsQuery(user, { max: 100 }))
    expect(leads.empty).toBe(false)
    const owners = new Set(leads.docs.map((d) => d.data().ownerId))
    expect(owners.size).toBeGreaterThan(2)

    const expenses = await getDocs(await expensesQuery(user, { max: 20 }))
    expect(expenses.empty).toBe(false)
  })

  it('an expense query filtered by month is indexed and allowed', async () => {
    await signOut(auth)
    const user = await signInAs('admin@haflaway.com')
    const monthKey = new Date().toISOString().slice(0, 7)
    await expect(getDocs(await expensesQuery(user, { monthKey }))).resolves.toBeDefined()
  })
})

describe('a viewer reads leads but never money', () => {
  it('lists leads, and is refused cost queries at the service layer', async () => {
    await signOut(auth)
    const user = await signInAs('viewer@haflaway.com')

    await expect(getDocs(await leadsQuery(user, { max: 10 }))).resolves.toBeDefined()
    await expect(expensesQuery(user)).rejects.toThrow(/may not read cost data/i)
  })
})

describe('a query builder refuses to run without an orgId', () => {
  it('throws rather than emitting a query the rules will reject', async () => {
    // The whole class of bug this file exists to prevent.
    await expect(leadsQuery({ uid: 'x', role: 'agent' })).rejects.toThrow(/orgId/i)
  })
})
