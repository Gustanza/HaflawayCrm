/**
 * Claim-first authorisation with a document fallback, and the first-admin bootstrap.
 *
 * Both are security-critical and both are new, so this file is deliberately adversarial:
 * it is more interested in what the mechanism must REFUSE than in what it allows.
 *
 * The bootstrap in particular is the only path in the entire ruleset by which someone
 * appoints themselves an administrator. If it can be used twice, or used by anyone other
 * than the caller who won the latch, it is a privilege-escalation hole.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, query, where, limit, getDocs } from 'firebase/firestore'
import {
  getTestEnv, teardown, clearData, seed, leadDoc, ORG, OTHER_ORG,
  as, asAgent, asAdmin, asAnonymous, assertFails, assertSucceeds,
} from './setup.js'

beforeAll(async () => {
  await getTestEnv()
})
afterAll(teardown)
beforeEach(clearData)

/** Signed in, but with no claims at all — an account made in the Auth console. */
const asClaimless = (uid = 'console-made') =>
  as(uid, { role: undefined, orgId: undefined, teamId: undefined, active: undefined })

function profileDoc(overrides = {}) {
  return {
    orgId: ORG,
    email: 'x@haflaway.com',
    displayName: 'Console Made',
    role: 'agent',
    teamId: 'team-a',
    isActive: true,
    locale: 'sw',
    createdAt: new Date(),
    createdBy: 'admin1',
    updatedAt: new Date(),
    updatedBy: 'admin1',
    ...overrides,
  }
}

/* ═══════════════════════════════════════════════ the document fallback ══════ */

describe('a user with NO claims is authorised from their document', () => {
  it('is denied everything when neither claim nor document exists', async () => {
    await seed('leads/l1', leadDoc({ ownerId: 'console-made' }))
    await assertFails(getDoc(doc(await asClaimless(), 'leads/l1')))
  })

  it('is granted their role once the document exists', async () => {
    await seed('users/console-made', profileDoc({ role: 'agent' }))
    await seed('leads/l1', leadDoc({ ownerId: 'console-made' }))

    const db = await asClaimless()
    await assertSucceeds(getDoc(doc(db, 'leads/l1')))
    await assertSucceeds(
      getDocs(query(collection(db, 'leads'), where('orgId', '==', ORG), where('ownerId', '==', 'console-made'), limit(5))),
    )
  })

  it('still cannot read a colleague lead — the fallback grants the ROLE, not more', async () => {
    await seed('users/console-made', profileDoc({ role: 'agent' }))
    await seed('leads/l2', leadDoc({ ownerId: 'someone-else' }))
    await assertFails(getDoc(doc(await asClaimless(), 'leads/l2')))
  })

  it('still cannot read cost data as an agent', async () => {
    await seed('users/console-made', profileDoc({ role: 'agent' }))
    await seed('expenses/e1', { orgId: ORG, category: 'salary', amountMinor: 1, enteredBy: 'f' })
    await assertFails(getDoc(doc(await asClaimless(), 'expenses/e1')))
  })

  it('honours isActive:false in the document exactly as the active claim would', async () => {
    await seed('users/console-made', profileDoc({ role: 'admin', isActive: false }))
    await seed('leads/l1', leadDoc({ ownerId: 'console-made' }))
    await assertFails(getDoc(doc(await asClaimless(), 'leads/l1')))
  })

  it('confines the fallback to the org named on the document', async () => {
    await seed('users/console-made', profileDoc({ role: 'admin', orgId: OTHER_ORG }))
    await seed('leads/l1', leadDoc({ orgId: ORG }))
    await assertFails(getDoc(doc(await asClaimless(), 'leads/l1')))
  })

  it('gives a document-authorised admin the same reach as a claim-authorised one', async () => {
    await seed('users/console-made', profileDoc({ role: 'admin' }))
    await seed('expenses/e1', { orgId: ORG, category: 'salary', amountMinor: 1, enteredBy: 'f' })
    await assertSucceeds(getDoc(doc(await asClaimless(), 'expenses/e1')))
  })

  it('lets the CLAIM win when both exist, so a synced demotion takes effect immediately', async () => {
    // Document says admin, claim says agent. The claim is the authority.
    await seed('users/demoted', profileDoc({ role: 'admin' }))
    await seed('expenses/e1', { orgId: ORG, category: 'salary', amountMinor: 1, enteredBy: 'f' })
    const db = await as('demoted', { role: 'agent', orgId: ORG, active: true })
    await assertFails(getDoc(doc(db, 'expenses/e1')))
  })

  it('refuses an anonymous visitor regardless', async () => {
    await seed('users/console-made', profileDoc({ role: 'admin' }))
    await seed('leads/l1', leadDoc())
    await assertFails(getDoc(doc(await asAnonymous(), 'leads/l1')))
  })
})

describe('a claimless user cannot promote themselves through the document', () => {
  beforeEach(async () => {
    await seed('users/console-made', profileDoc({ role: 'agent' }))
  })

  it('cannot write their own role', async () => {
    const db = await asClaimless()
    await assertFails(
      updateDoc(doc(db, 'users/console-made'), {
        role: 'admin', updatedAt: serverTimestamp(), updatedBy: 'console-made',
      }),
    )
  })

  it('cannot reactivate themselves', async () => {
    await seed('users/suspended', profileDoc({ role: 'agent', isActive: false }))
    const db = await asClaimless('suspended')
    await assertFails(
      updateDoc(doc(db, 'users/suspended'), {
        isActive: true, updatedAt: serverTimestamp(), updatedBy: 'suspended',
      }),
    )
  })

  it('cannot move themselves to another org', async () => {
    const db = await asClaimless()
    await assertFails(
      updateDoc(doc(db, 'users/console-made'), {
        orgId: OTHER_ORG, updatedAt: serverTimestamp(), updatedBy: 'console-made',
      }),
    )
  })

  it('cannot create a profile for themselves out of nothing', async () => {
    // No sentinel seeded, so there is no bootstrap route either.
    const db = await asClaimless('nobody')
    await assertFails(setDoc(doc(db, 'users/nobody'), profileDoc({ role: 'admin' })))
  })
})

/* ═══════════════════════════════════════════ the first-admin bootstrap ══════ */

const OPEN_SENTINEL = { claimed: false, claimedBy: null, orgId: ORG }

describe('the bootstrap sentinel', () => {
  beforeEach(async () => {
    await seed('settings/bootstrap', OPEN_SENTINEL)
  })

  it('is readable by anyone signed in — the setup screen reads it before having a role', async () => {
    await assertSucceeds(getDoc(doc(await asClaimless(), 'settings/bootstrap')))
  })

  it('is not readable by an anonymous visitor', async () => {
    await assertFails(getDoc(doc(await asAnonymous(), 'settings/bootstrap')))
  })

  it('can be claimed once, stamping the caller', async () => {
    await assertSucceeds(
      updateDoc(doc(await asClaimless(), 'settings/bootstrap'), {
        claimed: true, claimedBy: 'console-made', claimedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot be claimed in someone else name', async () => {
    await assertFails(
      updateDoc(doc(await asClaimless(), 'settings/bootstrap'), {
        claimed: true, claimedBy: 'somebody-else', claimedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot be back-dated', async () => {
    await assertFails(
      updateDoc(doc(await asClaimless(), 'settings/bootstrap'), {
        claimed: true, claimedBy: 'console-made', claimedAt: new Date('2020-01-01'),
      }),
    )
  })

  it('cannot be moved to another org while claiming', async () => {
    await assertFails(
      updateDoc(doc(await asClaimless(), 'settings/bootstrap'), {
        claimed: true, claimedBy: 'console-made', claimedAt: serverTimestamp(), orgId: OTHER_ORG,
      }),
    )
  })

  it('CANNOT BE CLAIMED TWICE — the whole safety property', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'first-winner', orgId: ORG })
    await assertFails(
      updateDoc(doc(await asClaimless('second-comer'), 'settings/bootstrap'), {
        claimed: true, claimedBy: 'second-comer', claimedAt: serverTimestamp(),
      }),
    )
  })

  it('cannot be re-opened by anyone, including an admin', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'first-winner', orgId: ORG })
    await assertFails(
      updateDoc(doc(await asAdmin(), 'settings/bootstrap'), { claimed: false, claimedBy: null }),
    )
  })

  it('cannot be deleted, even by an admin', async () => {
    // Deleting it would make `bootstrapOpen()` false and `bootstrapClaimedByMe()` false,
    // so it cannot reopen the door — but losing the record of who claimed it would.
    await assertFails(deleteDoc(doc(await asAdmin(), 'settings/bootstrap')))
  })

  it('a decoy settings document grants nothing', async () => {
    // An admin may write other settings docs; the rules only ever consult
    // `settings/bootstrap`, so a look-alike is inert.
    const db = await asAdmin()
    await assertSucceeds(setDoc(doc(db, 'settings/bootstrap2'), { ...OPEN_SENTINEL, orgId: ORG }))
    await assertFails(
      setDoc(doc(await asClaimless('opportunist'), 'users/opportunist'), profileDoc({ role: 'admin' })),
    )
  })
})

describe('the bootstrap winner, and only them, becomes admin', () => {
  it('may create their own admin profile after winning the latch', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    const db = await asClaimless('winner')

    await assertSucceeds(
      setDoc(doc(db, 'users/winner'), profileDoc({ role: 'admin', orgId: ORG })),
    )
    await assertSucceeds(
      setDoc(doc(db, 'usersPublic/winner'), {
        orgId: ORG, displayName: 'Winner', photoPath: null, isActive: true,
      }),
    )
  })

  it('is refused if the latch names somebody else', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await assertFails(
      setDoc(doc(await asClaimless('impostor'), 'users/impostor'), profileDoc({ role: 'admin' })),
    )
  })

  it('is refused while the latch is still open — order matters', async () => {
    // Claiming the sentinel FIRST is what makes this a mutex rather than a race.
    await seed('settings/bootstrap', OPEN_SENTINEL)
    await assertFails(
      setDoc(doc(await asClaimless('eager'), 'users/eager'), profileDoc({ role: 'admin' })),
    )
  })

  it('cannot create a profile for a DIFFERENT uid', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await assertFails(
      setDoc(doc(await asClaimless('winner'), 'users/someone-else'), profileDoc({ role: 'admin' })),
    )
  })

  it('cannot appoint themselves into a different org than the sentinel names', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await assertFails(
      setDoc(doc(await asClaimless('winner'), 'users/winner'), profileDoc({ role: 'admin', orgId: OTHER_ORG })),
    )
  })

  it('cannot use the bootstrap to create a deactivated-then-editable shell', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await assertFails(
      setDoc(doc(await asClaimless('winner'), 'users/winner'), profileDoc({ role: 'admin', isActive: false })),
    )
  })

  it('grants real admin access once the profile exists', async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await seed('users/winner', profileDoc({ role: 'admin', orgId: ORG }))
    await seed('expenses/e1', { orgId: ORG, category: 'salary', amountMinor: 1, enteredBy: 'f' })

    const db = await asClaimless('winner')
    await assertSucceeds(getDoc(doc(db, 'expenses/e1')))
  })
})

describe('a bootstrapped admin can then provision colleagues', () => {
  beforeEach(async () => {
    await seed('settings/bootstrap', { claimed: true, claimedBy: 'winner', orgId: ORG })
    await seed('users/winner', profileDoc({ role: 'admin', orgId: ORG }))
  })

  it('creates a profile and mirror for someone else', async () => {
    const db = await asClaimless('winner')
    await assertSucceeds(
      setDoc(doc(db, 'users/new-agent'), profileDoc({ role: 'agent', displayName: 'New Agent' })),
    )
    await assertSucceeds(
      setDoc(doc(db, 'usersPublic/new-agent'), {
        orgId: ORG, displayName: 'New Agent', photoPath: null, isActive: true,
      }),
    )
  })

  it('cannot create anyone into another organisation', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('winner'), 'users/foreigner'), profileDoc({ orgId: OTHER_ORG })),
    )
  })

  it('a non-admin still cannot create anyone', async () => {
    await seed('users/plain-agent', profileDoc({ role: 'agent' }))
    await assertFails(
      setDoc(doc(await asClaimless('plain-agent'), 'users/someone'), profileDoc({ role: 'agent' })),
    )
    await assertFails(
      setDoc(doc(await asAgent('agent1'), 'users/someone'), profileDoc({ role: 'agent' })),
    )
  })
})
