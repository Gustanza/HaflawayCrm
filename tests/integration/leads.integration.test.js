/**
 * The lead/pipeline SERVICE layer, against the REAL emulator, as REAL signed-in users.
 *
 * `tests/rules/leads.rules.test.js` proves firestore.rules accepts/rejects hand-built
 * writes. `tests/unit/stages.test.js` and `tests/unit/scoring.test.js` prove the domain
 * math in isolation. Neither proves that `src/services/leads.service.js` — the code every
 * view actually calls — produces writes the rules accept, or that its own pre-flight
 * validation (`validateTransition`) actually blocks what it claims to block once real
 * Firestore is on the other end. This file is that proof, following the pattern in
 * `queries.integration.test.js`.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, getDb } from '@/firebase/app.js'
import {
  createLead,
  checkPhoneAvailable,
  changeStage,
  logActivity,
  markFirstContact,
  reassignLead,
  DuplicateLeadError,
  InvalidPhoneError,
  phoneIndexKey,
} from '@/services/leads.service.js'
import { priorityScore } from '@/domain/scoring.js'

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
    displayName: credential.user.displayName ?? email,
  }
}

/** A phone number this test run owns exclusively, so parallel test files never collide. */
function freshPhone() {
  const n = Math.floor(100000 + Math.random() * 800000)
  return `0712${n}`
}

/** Soft-delete a probe lead: `allow delete: if false` in firestore.rules (soft delete only). */
async function retire(leadId, uid) {
  const db = await getDb()
  await updateDoc(doc(db, 'leads', leadId), {
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }).catch(() => {})
}

let agent1
let agent2
let manager

beforeAll(async () => {
  agent1 = await signInAs('agent1@haflaway.com')
})

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

describe('createLead — phone lock and defaults (§6.4)', () => {
  it('normalises the phone, claims the index, and stamps a system activity', async () => {
    const raw = '0712 345 ' + String(Math.floor(100 + Math.random() * 800))
    const leadId = await createLead({
      input: { primaryPhone: raw, displayName: 'Amina Test', source: 'field' },
      user: agent1,
    })

    const db = await getDb()
    const snap = await getDoc(doc(db, 'leads', leadId))
    const lead = snap.data()

    expect(lead.primaryPhoneNormalized).toMatch(/^\+255\d{9}$/)
    expect(lead.orgId).toBe(ORG)
    expect(lead.ownerId).toBe(agent1.uid)
    expect(lead.stage).toBe('new')
    expect(lead.leadStatus).toBe('open')
    expect(lead.qualification.budgetBand).toBe('unknown')
    expect(lead.qualification.decisionMakerContactId).toBeNull()

    const indexSnap = await getDoc(doc(db, 'leadPhoneIndex', phoneIndexKey(ORG, lead.primaryPhoneNormalized)))
    expect(indexSnap.exists()).toBe(true)
    expect(indexSnap.data().ownerId).toBe(agent1.uid)

    await retire(leadId, agent1.uid)
  })

  it('rejects an unusable phone number before writing anything', async () => {
    await expect(
      createLead({ input: { primaryPhone: 'not a phone at all' }, user: agent1 }),
    ).rejects.toBeInstanceOf(InvalidPhoneError)
  })

  it('blocks a second lead on a phone already claimed, EVEN across different spellings', async () => {
    // The whole point of normalisation (phone.js): three spellings of the same number must
    // collide on the same index key, or the dedupe lock silently does nothing.
    const national = '0712' + String(Math.floor(100000 + Math.random() * 800000))
    const firstId = await createLead({
      input: { primaryPhone: national, displayName: 'Original Owner' },
      user: agent1,
    })

    const db = await getDb()
    const firstLead = (await getDoc(doc(db, 'leads', firstId))).data()
    const e164 = firstLead.primaryPhoneNormalized
    const international = e164 // +255712xxxxxx
    const withIddZero = '00' + e164.slice(1) // 00255712xxxxxx — a pasted IDD spelling

    for (const spelling of [international, withIddZero]) {
      await expect(
        createLead({ input: { primaryPhone: spelling, displayName: 'Duplicate Attempt' }, user: agent1 }),
      ).rejects.toMatchObject({ leadId: firstId, ownerId: agent1.uid })
    }

    const probe = await checkPhoneAvailable(national, ORG)
    expect(probe.available).toBe(false)
    expect(probe.leadId).toBe(firstId)

    await retire(firstId, agent1.uid)
  })
})

describe('changeStage — the §5.2 state machine, enforced by the client BEFORE any write', () => {
  let leadId
  let lead

  beforeAll(async () => {
    leadId = await createLead({
      input: {
        primaryPhone: freshPhone(),
        displayName: 'Pipeline Probe',
        eventDate: new Date(Date.now() + 40 * 24 * 3600 * 1000),
      },
      user: agent1,
    })
    const db = await getDb()
    lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
  })

  afterAll(async () => {
    await retire(leadId, agent1.uid)
  })

  it('refuses to skip the funnel (new -> won) and leaves the document untouched', async () => {
    await expect(
      changeStage({ lead, toStage: 'won', user: agent1 }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })

    const db = await getDb()
    const after = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(after.stage).toBe('new') // unchanged — the illegal move never reached Firestore
  })

  it(
    'the qualified gate rejects an incomplete qualification (BEDS), even with eventDate set — ' +
      'LeadDetailView.vue now supplies budgetBand/decisionMakerContactId via its own form ' +
      '(the "qualified" branch of the stage-change modal), but the gate itself must still ' +
      'refuse a lead that skips it, e.g. moved by a future API caller or a script.',
    async () => {
      // Move to contacted first — a real precondition for entering qualified.
      await changeStage({ lead, toStage: 'contacted', user: agent1 })
      const db = await getDb()
      const contacted = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
      expect(contacted.stage).toBe('contacted')
      // eventDate is already set on this fixture (BEDS' one field the UI CAN supply, at
      // quick-add). Even so:
      await expect(
        changeStage({ lead: contacted, toStage: 'qualified', user: agent1 }),
      ).rejects.toMatchObject({
        code: 'MISSING_FIELDS',
        missing: expect.arrayContaining([
          'qualification.budgetBand',
          'qualification.decisionMakerContactId',
        ]),
      })
    },
  )

  it('once BEDS is supplied, the funnel opens end to end through changeStage()/firestore.rules', async () => {
    // Exercises the service layer directly with the same shape LeadDetailView.vue's
    // "qualified" form now produces (a merged qualification object, not a dotted-path key —
    // see extras' comment in LeadDetailView.vue for why that distinction matters).
    const db = await getDb()
    let current = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    await changeStage({
      lead: current,
      toStage: 'qualified',
      user: agent1,
      extra: {
        qualification: {
          ...current.qualification,
          budgetBand: '150-500k',
          decisionMakerContactId: 'contact-1',
        },
      },
    })
    current = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    expect(current.stage).toBe('qualified')

    // quoted requires dealValueMinor (this part DOES have UI, on LeadDetailView).
    await changeStage({
      lead: current,
      toStage: 'quoted',
      user: agent1,
      extra: { dealValueMinor: 15_000_000 },
    })
    current = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    expect(current.stage).toBe('quoted')
    expect(current.dealValueMinor).toBe(15_000_000)

    await changeStage({ lead: current, toStage: 'negotiation', user: agent1 })
    current = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    await changeStage({ lead: current, toStage: 'won', user: agent1 })
    current = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    expect(current.stage).toBe('won')
    expect(current.leadStatus).toBe('closed_won')
    expect(current.closedAt).not.toBeNull()
    expect(current.closedBy).toBe(agent1.uid)
    // A closed lead must stop appearing in the work queue.
    expect(current.nextActionAt).toBeNull()
  })
})

describe('changeStage — closure fields enforced end to end (not just at the rules layer)', () => {
  it('refuses to lose a deal with no lossReason, before touching Firestore', async () => {
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Loss Probe' },
      user: agent1,
    })
    const db = await getDb()
    let lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    await changeStage({ lead, toStage: 'contacted', user: agent1 })
    lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    await expect(
      changeStage({ lead, toStage: 'lost', user: agent1 }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELDS', missing: ['lossReason'] })

    const unchanged = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(unchanged.stage).toBe('contacted')
    expect(unchanged.closedAt).toBeNull()

    await changeStage({ lead, toStage: 'lost', user: agent1, extra: { lossReason: 'price' } })
    const closed = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(closed.stage).toBe('lost')
    expect(closed.leadStatus).toBe('closed_lost')
    expect(closed.lossReason).toBe('price')
    expect(closed.closedAt).not.toBeNull()

    await retire(leadId, agent1.uid)
  })

  it('refuses to win a deal worth zero, even though dealValueMinor is technically "present"', async () => {
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Zero Deal Probe' },
      user: agent1,
    })
    const db = await getDb()
    let lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    await changeStage({
      lead,
      toStage: 'contacted',
      user: agent1,
    })
    lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    await changeStage({
      lead,
      toStage: 'qualified',
      user: agent1,
      extra: {
        qualification: { ...lead.qualification, budgetBand: '50-150k', decisionMakerContactId: 'c1' },
        eventDate: new Date(Date.now() + 60 * 24 * 3600 * 1000),
      },
    })
    lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    await changeStage({ lead, toStage: 'quoted', user: agent1, extra: { dealValueMinor: 0 } })
    lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }
    expect(lead.stage).toBe('quoted')
    expect(lead.dealValueMinor).toBe(0)

    await expect(changeStage({ lead, toStage: 'won', user: agent1 })).rejects.toMatchObject({
      code: 'INVALID_DEAL_VALUE',
    })
    const stillQuoted = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(stillQuoted.stage).toBe('quoted')

    await retire(leadId, agent1.uid)
  })

  it('disqualifying a lead succeeds and stamps closedAt/closedBy, same as won/lost', async () => {
    // Regression: changeStage() used to stamp closedAt/closedBy only for
    // ['won', 'lost'], but firestore.rules' closureFieldsPresent() requires them for EVERY
    // stage in TERMINAL_STAGES — which includes 'disqualified'. That mismatch meant moving
    // ANY lead to disqualified was refused with "Missing or insufficient permissions" for
    // every caller, including a genuine admin — found by a real user hitting it live.
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Disqualify Regression' },
      user: agent1,
    })
    const db = await getDb()
    const lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    await changeStage({ lead, toStage: 'disqualified', user: agent1 })

    const closed = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(closed.stage).toBe('disqualified')
    expect(closed.leadStatus).toBe('closed_lost')
    expect(closed.closedAt).not.toBeNull()
    expect(closed.closedBy).toBe(agent1.uid)
    expect(closed.nextActionAt).toBeNull()

    await retire(leadId, agent1.uid)
  })
})

describe('logActivity — atomic counters that priorityScore/engagementScore depend on', () => {
  it('increments consecutiveNoAnswer and contactAttempts as server transforms, not client math', async () => {
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Counter Probe' },
      user: agent1,
    })
    const db = await getDb()

    // Two "no_answer" calls logged back-to-back. If this used client-computed
    // `current + 1` instead of increment(), a race would lose one — that is exactly the
    // regression documented in leads.service.js above logActivity().
    await Promise.all([
      logActivity({ leadId, user: agent1, activity: { type: 'call', outcome: 'no_answer' } }),
      logActivity({ leadId, user: agent1, activity: { type: 'call', outcome: 'no_answer' } }),
    ])

    const lead = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(lead.consecutiveNoAnswer).toBe(2)
    expect(lead.contactAttempts).toBe(2)
    expect(lead.lastContactedAt).toBeNull()

    await retire(leadId, agent1.uid)
  })
})

describe('logActivity({ outcome: "spoke" }) succeeds and stamps firstContactedAt', () => {
  // Regression coverage for a bug that made EVERY "spoke" outcome throw permission-denied:
  // markFirstContact() updated only `firstContactedAt`, but firestore.rules' updateStamped()
  // refuses any lead update that does not also touch `updatedAt`/`updatedBy`. "spoke"
  // (answered/talked to the customer) is the single most common outcome an agent logs, so
  // this silently broke the most common save in the app and permanently prevented
  // `firstContactedAt` — the input to the §8.6 "first response time" metric — from ever
  // being stamped. Fixed by having markFirstContact() take the acting user and stamp
  // updatedAt/updatedBy like every other lead write does.
  it('logActivity with outcome "spoke" resolves and stamps firstContactedAt exactly once', async () => {
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Spoke Regression' },
      user: agent1,
    })
    const db = await getDb()
    try {
      await logActivity({ leadId, user: agent1, activity: { type: 'call', outcome: 'spoke' } })
      const first = (await getDoc(doc(db, 'leads', leadId))).data()
      expect(first.firstContactedAt).toBeTruthy()
      expect(first.lastContactedAt).toBeTruthy()

      // Write-once: a SECOND "spoke" must not move firstContactedAt.
      const stampedAt = first.firstContactedAt
      await logActivity({ leadId, user: agent1, activity: { type: 'call', outcome: 'spoke' } })
      const second = (await getDoc(doc(db, 'leads', leadId))).data()
      expect(second.firstContactedAt.isEqual(stampedAt)).toBe(true)
    } finally {
      await retire(leadId, agent1.uid)
    }
  })

  it('markFirstContact() itself succeeds on a lead never contacted', async () => {
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Spoke Regression 2' },
      user: agent1,
    })
    const db = await getDb()
    try {
      await markFirstContact(leadId, agent1)
      const lead = (await getDoc(doc(db, 'leads', leadId))).data()
      expect(lead.firstContactedAt).toBeTruthy()
    } finally {
      await retire(leadId, agent1.uid)
    }
  })
})

describe('reassignLead — anti-poaching path (manager only)', () => {
  beforeAll(async () => {
    manager = await signInAs('manager.dar@haflaway.com')
    agent2 = await signInAs('agent2@haflaway.com')
    // Re-sign-in as agent1 for setup below since signInAs() moves the shared `auth` session.
  })

  it('moves ownership, keeps history, and repoints the phone index', async () => {
    // Create as agent1 (agent1 is signed in from the outer beforeAll's last sign-in — but
    // signInAs() reassigned the module-level `auth` session above, so re-establish agent1.
    agent1 = await signInAs('agent1@haflaway.com')
    const phone = freshPhone()
    const leadId = await createLead({
      input: { primaryPhone: phone, displayName: 'Reassign Probe' },
      user: agent1,
    })

    const db = await getDb()
    const lead = { id: leadId, ...(await getDoc(doc(db, 'leads', leadId))).data() }

    manager = await signInAs('manager.dar@haflaway.com')
    await reassignLead({
      lead,
      toUserId: agent2.uid,
      toUserName: 'Frank Ndosi',
      user: manager,
      reason: 'Load balancing',
    })

    const after = (await getDoc(doc(db, 'leads', leadId))).data()
    expect(after.ownerId).toBe(agent2.uid)
    expect(after.previousOwnerIds).toContain(agent1.uid)

    const indexAfter = (
      await getDoc(doc(db, 'leadPhoneIndex', phoneIndexKey(ORG, after.primaryPhoneNormalized)))
    ).data()
    expect(indexAfter.ownerId).toBe(agent2.uid)

    await retire(leadId, manager.uid)
    agent1 = await signInAs('agent1@haflaway.com')
  })
})

describe('createLead stores a priorityScore that respects the §8.7 urgency floor', () => {
  // Regression coverage: createLead() used to call
  // priorityScore({ urgency, qualification, engagement }) with no `days`, so urgencyFloor(null)
  // silently returned 0 and the STORED field was the bare blend, not the floored value every
  // view recomputes at render time. Fixed by passing `days` through, matching
  // recomputeScores()'s existing pattern.
  it('stored priorityScore matches priorityScore(leadDocument) inside the floor window', async () => {
    const eventDate = new Date(Date.now() + 5 * 24 * 3600 * 1000) // 5 days out -> floor 90
    const leadId = await createLead({
      input: { primaryPhone: freshPhone(), displayName: 'Floor Regression', eventDate },
      user: agent1,
    })
    const db = await getDb()
    const lead = (await getDoc(doc(db, 'leads', leadId))).data()
    const correct = priorityScore(lead)

    await retire(leadId, agent1.uid)

    expect(lead.priorityScore).toBe(correct)
    expect(lead.priorityScore).toBeGreaterThanOrEqual(90) // the floor itself, not just self-consistency
  })
})
