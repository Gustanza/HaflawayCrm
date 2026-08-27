/**
 * The whole point of campaigns, end to end: which leads came from which campaign, what that
 * campaign cost, and therefore what a customer from it cost to acquire.
 *
 * Before this existed the loop was broken in two places at once and the break was invisible:
 * LeadQuickAddView never sent `campaignId` (so every lead attributed to nothing), and no
 * screen wrote `campaigns/{id}/spend` (so every campaign cost zero). CampaignsView computed
 * CPL/CAC/ROAS correctly over both — and therefore always rendered nothing. This exercises
 * the two write paths the UI now performs and then runs the REAL reporting maths over them.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, getDb } from '@/firebase/app.js'
import { createLead, changeStage } from '@/services/leads.service.js'
import { fetchCampaignSpend } from '@/services/queries.js'
import { cacBy } from '@/domain/metrics.js'
import { periodKeys } from '@/domain/periods.js'
import { toMinor, divideMinor } from '@/domain/money.js'

let user
let campaignA
let campaignB

const POLICY = {
  includeSalariesInCAC: false,
  includeCommissionInCAC: false,
  overheadMethod: 'none',
}

/** Unique per run so repeat runs cannot collide on the phone dedupe index. */
const stamp = Date.now()
// +255 then exactly 9 national digits (12 digits in all). One digit over and
// normalizePhone rejects it, which is how the first run of this file failed.
const phone = (n) => `+2557${String(stamp).slice(-7)}${n}`

async function makeCampaign(name, channel) {
  const db = await getDb()
  const ref = doc(collection(db, 'campaigns'))
  const now = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(ref, {
    orgId: user.orgId,
    name,
    channel,
    budgetMinor: 0,
    status: 'active',
    startDate: now,
    ownerId: user.uid,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  })
  batch.set(doc(db, 'campaignsPublic', ref.id), {
    orgId: user.orgId,
    name,
    channel,
    status: 'active',
  })
  await batch.commit()
  return ref.id
}

/** Exactly what CampaignsView.saveSpend() writes. */
async function recordSpend(campaignId, majorAmount, isoDate) {
  const db = await getDb()
  const spentOn = new Date(`${isoDate}T12:00:00`)
  await addDoc(collection(db, 'campaigns', campaignId, 'spend'), {
    ...periodKeys(spentOn),
    spentOn,
    amountMinor: toMinor(majorAmount),
    currency: 'TZS',
    source: 'manual',
    enteredBy: user.uid,
    createdAt: serverTimestamp(),
  })
}

/** Exactly what LeadQuickAddView now sends. */
async function makeLead(n, campaignId, source) {
  return createLead({
    input: {
      primaryPhone: phone(n),
      displayName: `Attribution probe ${stamp}-${n}`,
      eventType: 'harusi',
      eventDate: new Date(Date.now() + 40 * 86400000),
      source,
      channel: source,
      campaignId,
      nextActionAt: new Date(),
      nextActionType: 'call',
    },
    user,
  })
}

/**
 * Drive a lead from `new` to `won` along the only legal path, satisfying each stage's
 * §5.3 BEDS requirements on the way: `qualified` needs a budget band, an event date and a
 * decision maker; `quoted` and `won` need a deal value.
 */
async function winTheDeal(leadId) {
  const db = await getDb()
  const read = async () => {
    const snap = await getDoc(doc(db, 'leads', leadId))
    return { id: snap.id, ...snap.data() }
  }

  await changeStage({ lead: await read(), toStage: 'contacted', user })
  await changeStage({
    lead: await read(),
    toStage: 'qualified',
    user,
    extra: {
      qualification: { budgetBand: '150-500k', decisionMakerContactId: 'Mama Neema' },
    },
  })
  await changeStage({
    lead: await read(),
    toStage: 'quoted',
    user,
    extra: { dealValueMinor: toMinor('900000') },
  })
  await changeStage({ lead: await read(), toStage: 'won', user })
}

beforeAll(async () => {
  const credential = await signInWithEmailAndPassword(auth, 'admin@haflaway.com', 'haflaway123')
  const token = await credential.user.getIdTokenResult(true)
  user = {
    uid: credential.user.uid,
    role: token.claims.role,
    orgId: token.claims.orgId,
    teamId: token.claims.teamId ?? null,
    displayName: 'Asha Mwinyi',
  }
  campaignA = await makeCampaign(`Probe A ${stamp}`, 'instagram')
  campaignB = await makeCampaign(`Probe B ${stamp}`, 'facebook')
}, 40000)

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

describe('a lead remembers which campaign brought it in', () => {
  it('stores campaignId on the lead, frozen at first touch', async () => {
    const id = await makeLead(1, campaignA, 'instagram')
    const db = await getDb()
    const snap = await getDoc(doc(db, 'leads', id))

    expect(snap.exists()).toBe(true)
    expect(snap.data().attribution.campaignId).toBe(campaignA)
    expect(snap.data().attribution.model).toBe('first_touch')
  })

  it('leaves campaignId null when the lead came from no campaign', async () => {
    // A committee visit belongs to no campaign. Forcing a choice would invent data.
    const id = await makeLead(2, null, 'committee')
    const db = await getDb()
    const snap = await getDoc(doc(db, 'leads', id))
    expect(snap.data().attribution.campaignId).toBeNull()
  })
})

describe('spend + attribution produce a real per-campaign CAC', () => {
  it('answers "did the cheaper campaign bring more leads?"', async () => {
    // A costs 300,000 and brings 3 leads. B costs 600,000 and brings 1.
    await recordSpend(campaignA, '200000', '2026-08-10')
    await recordSpend(campaignA, '100000', '2026-08-11')
    await recordSpend(campaignB, '600000', '2026-08-10')

    const a1 = await makeLead(3, campaignA, 'instagram')
    await makeLead(4, campaignA, 'instagram')
    await makeLead(5, campaignB, 'facebook')

    // Win one deal on A, so it has a CAC and not merely a CPL.
    //
    // Walked through the REAL state machine rather than patched straight to `won`. A raw
    // updateDoc is refused by firestore.rules (and `new -> won` is not a legal transition
    // anyway) — the first draft of this test tried exactly that and was denied, which is
    // the rules doing their job.
    const db = await getDb()
    await winTheDeal(a1)

    // ---- read the spend back through the REAL query path the screen uses ----
    const spend = await fetchCampaignSpend(user, [campaignA, campaignB])
    const spendById = new Map()
    for (const entry of spend) {
      spendById.set(entry.campaignId, (spendById.get(entry.campaignId) ?? 0) + entry.amountMinor)
    }

    expect(spendById.get(campaignA), 'campaign A spend').toBe(toMinor('300000'))
    expect(spendById.get(campaignB), 'campaign B spend').toBe(toMinor('600000'))

    // ---- and run the REAL reporting maths over the real documents ----
    const snap = await getDocs(
      query(
        collection(db, 'leads'),
        where('orgId', '==', user.orgId),
        where('attribution.campaignId', 'in', [campaignA, campaignB]),
      ),
    )
    const leads = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

    const rows = cacBy(
      leads,
      (lead) => lead.attribution?.campaignId ?? null,
      (id) => ({ expenses: [], campaignSpend: [{ amountMinor: spendById.get(id) ?? 0 }] }),
      POLICY,
    )
    const rowA = rows.find((r) => r.key === campaignA)
    const rowB = rows.find((r) => r.key === campaignB)

    expect(rowA.leads, 'A lead count').toBe(3)
    expect(rowB.leads, 'B lead count').toBe(1)

    // The actual business question: cost per lead.
    const cplA = divideMinor(spendById.get(campaignA), rowA.leads)
    const cplB = divideMinor(spendById.get(campaignB), rowB.leads)
    expect(cplA, 'A cost per lead').toBe(toMinor('100000'))
    expect(cplB, 'B cost per lead').toBe(toMinor('600000'))
    expect(cplA).toBeLessThan(cplB) // A is 6x cheaper per lead — the whole point.

    // CAC exists only where a deal was actually won.
    expect(rowA.won, 'A won').toBe(1)
    expect(rowB.won, 'B won').toBe(0)
    expect(rowA.totalCostMinor, 'A total cost feeding CAC').toBe(toMinor('300000'))
  }, 40000)
})
