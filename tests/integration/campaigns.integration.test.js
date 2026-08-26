/**
 * Creating a campaign, end to end — the flow CampaignsView.vue's "+ Add campaign" form runs.
 *
 * Until this file existed there was NO way to create a campaign through the app at all: the
 * screen was purely a read/report view (a real gap a user found by actually using the
 * deployed site — automated testing had only ever exercised campaigns that scripts/seed.js
 * pre-populated with the Admin SDK, which bypasses rules entirely). This exercises the exact
 * two-document batch write the fixed view now performs, against the real rules.
 *
 * Not read-only: this file creates real campaign documents in the shared emulator project.
 * Campaigns cannot be deleted (firestore.rules: `allow delete: if false`), so these persist
 * for the life of the emulator's data — harmless local/disposable state, cleared whenever
 * `.emulator-data` is wiped and reseeded.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, afterAll } from 'vitest'
import { collection, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, getDb } from '@/firebase/app.js'

async function signInAs(email) {
  const credential = await signInWithEmailAndPassword(auth, email, 'haflaway123')
  const token = await credential.user.getIdTokenResult(true)
  return {
    uid: credential.user.uid,
    role: token.claims.role,
    orgId: token.claims.orgId,
  }
}

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

/** Exactly the batch CampaignsView.vue's saveCampaign() writes. */
async function createCampaign(user, { name, channel = 'instagram', budgetMinor = 0 } = {}) {
  const db = await getDb()
  const campaignRef = doc(collection(db, 'campaigns'))
  const now = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(campaignRef, {
    orgId: user.orgId,
    name,
    channel,
    budgetMinor,
    status: 'active',
    startDate: now,
    ownerId: user.uid,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  })
  batch.set(doc(db, 'campaignsPublic', campaignRef.id), {
    orgId: user.orgId,
    name,
    channel,
    status: 'active',
  })
  await batch.commit()
  return campaignRef.id
}

describe('creating a campaign', () => {
  it('finance can create one, and the redacted mirror carries no budget', async () => {
    const finance = await signInAs('finance@haflaway.com')
    const id = await createCampaign(finance, { name: 'Regression — Finance Create', budgetMinor: 5_000_000 })

    const db = await getDb()
    const full = (await getDoc(doc(db, 'campaigns', id))).data()
    expect(full.name).toBe('Regression — Finance Create')
    expect(full.budgetMinor).toBe(5_000_000)
    expect(full.orgId).toBe(finance.orgId)

    const mirror = (await getDoc(doc(db, 'campaignsPublic', id))).data()
    expect(mirror.name).toBe('Regression — Finance Create')
    expect(mirror.budgetMinor).toBeUndefined() // §7.2 — agents/viewers must never see budget

    await signOut(auth)
  })

  it('admin can create one too', async () => {
    const admin = await signInAs('admin@haflaway.com')
    const id = await createCampaign(admin, { name: 'Regression — Admin Create' })
    const db = await getDb()
    expect((await getDoc(doc(db, 'campaigns', id))).exists()).toBe(true)
    await signOut(auth)
  })

  it('a manager can READ campaigns but is refused creating one — matches isFinance()-only in firestore.rules', async () => {
    const manager = await signInAs('manager.dar@haflaway.com')
    await expect(createCampaign(manager, { name: 'Should Not Exist' })).rejects.toMatchObject({
      code: expect.stringMatching(/permission-denied/),
    })
    await signOut(auth)
  })

  it('an agent is refused', async () => {
    const agent = await signInAs('agent1@haflaway.com')
    await expect(createCampaign(agent, { name: 'Should Not Exist' })).rejects.toMatchObject({
      code: expect.stringMatching(/permission-denied/),
    })
    await signOut(auth)
  })

  it('a viewer is refused', async () => {
    const viewer = await signInAs('viewer@haflaway.com')
    await expect(createCampaign(viewer, { name: 'Should Not Exist' })).rejects.toMatchObject({
      code: expect.stringMatching(/permission-denied/),
    })
    await signOut(auth)
  })

  it('cannot be created into a different organisation than the caller', async () => {
    const finance = await signInAs('finance@haflaway.com')
    await expect(
      createCampaign({ ...finance, orgId: 'someone-else' }, { name: 'Cross-org attempt' }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/permission-denied/) })
    await signOut(auth)
  })
})
