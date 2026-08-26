/**
 * Claim-first authorisation with a document fallback, and self-service organisation
 * registration.
 *
 * Both are security-critical, so this file is deliberately adversarial: it is more
 * interested in what the mechanism must REFUSE than in what it allows.
 *
 * `orgs/{orgId}` registration in particular is the only path in the entire ruleset by which
 * someone appoints themselves an administrator. Unlike the single-use `settings/bootstrap`
 * sentinel it replaced, this one must work REPEATABLY — two different people, two different
 * orgIds — while still making it impossible for the same orgId to be claimed twice, or for
 * anyone but its true owner to use it to promote themselves.
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

/** Signed in, but with no claims at all — an account made in the Auth console, or one that
 *  just self-registered and has not had its claim synced yet. */
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

function orgDoc(orgId, ownerUid, overrides = {}) {
  return {
    orgId,
    name: 'A New Company',
    ownerUid,
    createdBy: ownerUid,
    // A real create (not a rules-bypassing seed()) must match request.time exactly —
    // a plain Date() fails `incoming().createdAt == request.time` just like a genuinely
    // backdated write would, so the default here has to be the server sentinel.
    createdAt: serverTimestamp(),
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
    // No orgs/{orgId} doc naming them owner, so there is no registration route either.
    const db = await asClaimless('nobody')
    await assertFails(setDoc(doc(db, 'users/nobody'), profileDoc({ role: 'admin' })))
  })
})

/* ═══════════════════════════════════════ orgs/{orgId} — the registration lock ══ */

describe('orgs/{orgId} — creating a new organisation', () => {
  it('succeeds for a claimless signed-in user with self-consistent data', async () => {
    const db = await asClaimless('founder')
    await assertSucceeds(setDoc(doc(db, 'orgs/newco'), orgDoc('newco', 'founder')))
  })

  it('refuses when the orgId field does not match the document path', async () => {
    const db = await asClaimless('founder')
    await assertFails(setDoc(doc(db, 'orgs/newco'), orgDoc('someone-elses-slug', 'founder')))
  })

  it('refuses when ownerUid is not the caller', async () => {
    const db = await asClaimless('founder')
    await assertFails(setDoc(doc(db, 'orgs/newco'), orgDoc('newco', 'somebody-else')))
  })

  it('refuses when createdBy is not the caller', async () => {
    const db = await asClaimless('founder')
    await assertFails(
      setDoc(doc(db, 'orgs/newco'), { ...orgDoc('newco', 'founder'), createdBy: 'somebody-else' }),
    )
  })

  it('refuses a backdated createdAt', async () => {
    const db = await asClaimless('founder')
    await assertFails(
      setDoc(doc(db, 'orgs/newco'), { ...orgDoc('newco', 'founder'), createdAt: new Date('2020-01-01') }),
    )
  })

  it('requires createdAt to be the server clock', async () => {
    const db = await asClaimless('founder')
    await assertSucceeds(
      setDoc(doc(db, 'orgs/newco'), { ...orgDoc('newco', 'founder'), createdAt: serverTimestamp() }),
    )
  })

  it.each([
    ['uppercase', 'NewCo'],
    ['underscore', 'new_co'],
    ['too short', 'a'],
    ['too long', 'a'.repeat(41)],
    ['spaces', 'new co'],
  ])('refuses a malformed orgId (%s)', async (_label, badId) => {
    const db = await asClaimless('founder')
    await assertFails(setDoc(doc(db, `orgs/${badId}`), orgDoc(badId, 'founder')))
  })

  it('refuses an empty or oversized company name', async () => {
    const db = await asClaimless('founder')
    await assertFails(setDoc(doc(db, 'orgs/newco'), orgDoc('newco', 'founder', { name: '' })))
    await assertFails(setDoc(doc(db, 'orgs/newco'), orgDoc('newco', 'founder', { name: 'x'.repeat(201) })))
  })

  it('CANNOT BE CREATED TWICE — this is the whole safety property', async () => {
    await seed('orgs/newco', orgDoc('newco', 'first-founder'))
    const db = await asClaimless('second-founder')
    await assertFails(setDoc(doc(db, 'orgs/newco'), orgDoc('newco', 'second-founder')))
  })

  it('can never be updated, even by its own owner or an unrelated admin', async () => {
    await seed('orgs/newco', orgDoc('newco', 'founder'))
    await assertFails(
      updateDoc(doc(await asClaimless('founder'), 'orgs/newco'), { name: 'Renamed' }),
    )
    await assertFails(updateDoc(doc(await asAdmin(), 'orgs/newco'), { ownerUid: 'admin1' }))
  })

  it('can never be deleted, even by its own owner or an unrelated admin', async () => {
    await seed('orgs/newco', orgDoc('newco', 'founder'))
    await assertFails(deleteDoc(doc(await asClaimless('founder'), 'orgs/newco')))
    await assertFails(deleteDoc(doc(await asAdmin(), 'orgs/newco')))
  })

  it('TWO DIFFERENT USERS EACH CREATE A DIFFERENT ORG — the core new capability', async () => {
    // Structurally impossible under the old single global bootstrap sentinel: only one
    // orgId, ever, for the whole deployment. This is the property that replaces it.
    await assertSucceeds(
      setDoc(doc(await asClaimless('founder-a'), 'orgs/acme'), orgDoc('acme', 'founder-a')),
    )
    await assertSucceeds(
      setDoc(doc(await asClaimless('founder-b'), 'orgs/beta'), orgDoc('beta', 'founder-b')),
    )
  })
})

describe('orgs/{orgId} — read visibility is private', () => {
  beforeEach(async () => {
    await seed('orgs/newco', orgDoc('newco', 'founder'))
  })

  it('a nonexistent org is readable by anyone signed in — probing for a free slug', async () => {
    await assertSucceeds(getDoc(doc(await asClaimless('anybody'), 'orgs/does-not-exist')))
  })

  it('a stranger cannot read an existing org', async () => {
    await assertFails(getDoc(doc(await asClaimless('stranger'), 'orgs/newco')))
  })

  it('the org creator can read it, even before their profile exists', async () => {
    await assertSucceeds(getDoc(doc(await asClaimless('founder'), 'orgs/newco')))
  })

  it('a member of the org (via claims) can read it', async () => {
    const db = await as('agent1', { role: 'agent', orgId: 'newco' })
    await assertSucceeds(getDoc(doc(db, 'orgs/newco')))
  })

  it('a member of a DIFFERENT org cannot read it', async () => {
    await assertFails(getDoc(doc(await asAdmin(), 'orgs/newco'))) // asAdmin() is orgId=ORG
  })

  it('listing orgs is always denied, even for the owner', async () => {
    await assertFails(getDocs(query(collection(await asClaimless('founder'), 'orgs'), limit(5))))
  })
})

describe('the org owner, and only them, becomes its admin', () => {
  beforeEach(async () => {
    await seed('orgs/newco', orgDoc('newco', 'founder'))
  })

  it('may create their own admin profile once the org exists', async () => {
    const db = await asClaimless('founder')
    await assertSucceeds(
      setDoc(doc(db, 'users/founder'), profileDoc({ role: 'admin', orgId: 'newco' })),
    )
    await assertSucceeds(
      setDoc(doc(db, 'usersPublic/founder'), {
        orgId: 'newco', displayName: 'Founder', photoPath: null, isActive: true,
      }),
    )
  })

  it('is refused for an impostor uid', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('impostor'), 'users/impostor'), profileDoc({ role: 'admin', orgId: 'newco' })),
    )
  })

  it('is refused while the org does not exist yet — order matters', async () => {
    const db = await asClaimless('eager')
    await assertFails(setDoc(doc(db, 'users/eager'), profileDoc({ role: 'admin', orgId: 'no-such-org' })))
  })

  it('cannot create a profile for a DIFFERENT uid', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('founder'), 'users/someone-else'), profileDoc({ role: 'admin', orgId: 'newco' })),
    )
  })

  it('cannot appoint themselves into someone else org', async () => {
    await seed('orgs/rival', orgDoc('rival', 'rival-founder'))
    await assertFails(
      setDoc(doc(await asClaimless('founder'), 'users/founder'), profileDoc({ role: 'admin', orgId: 'rival' })),
    )
  })

  it('cannot use registration to create a deactivated-then-editable shell', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('founder'), 'users/founder'), profileDoc({ role: 'admin', orgId: 'newco', isActive: false })),
    )
  })

  it('cannot appoint themselves anything other than admin', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('founder'), 'users/founder'), profileDoc({ role: 'manager', orgId: 'newco' })),
    )
  })

  it('grants real admin access once the profile exists', async () => {
    await seed('users/founder', profileDoc({ role: 'admin', orgId: 'newco' }))
    await seed('expenses/e1', { orgId: 'newco', category: 'salary', amountMinor: 1, enteredBy: 'f' })

    const db = await asClaimless('founder')
    await assertSucceeds(getDoc(doc(db, 'expenses/e1')))
  })
})

describe('a self-registered admin can then provision colleagues', () => {
  beforeEach(async () => {
    await seed('orgs/newco', orgDoc('newco', 'founder'))
    await seed('users/founder', profileDoc({ role: 'admin', orgId: 'newco' }))
  })

  it('creates a profile and mirror for someone else', async () => {
    const db = await asClaimless('founder')
    await assertSucceeds(
      setDoc(doc(db, 'users/new-agent'), profileDoc({ role: 'agent', orgId: 'newco', displayName: 'New Agent' })),
    )
    await assertSucceeds(
      setDoc(doc(db, 'usersPublic/new-agent'), {
        orgId: 'newco', displayName: 'New Agent', photoPath: null, isActive: true,
      }),
    )
  })

  it('cannot create anyone into another organisation', async () => {
    await assertFails(
      setDoc(doc(await asClaimless('founder'), 'users/foreigner'), profileDoc({ role: 'agent', orgId: OTHER_ORG })),
    )
  })

  it('a non-admin still cannot create anyone', async () => {
    await seed('users/plain-agent', profileDoc({ role: 'agent', orgId: 'newco' }))
    await assertFails(
      setDoc(doc(await asClaimless('plain-agent'), 'users/someone'), profileDoc({ role: 'agent', orgId: 'newco' })),
    )
    await assertFails(
      setDoc(doc(await asAgent('agent1'), 'users/someone'), profileDoc({ role: 'agent' })),
    )
  })
})

describe('users/{userId} — reading a NONEXISTENT profile (adoptExistingUser probing)', () => {
  // adoptExistingUser() in provisioning.service.js checks whether a console-made uid already
  // has a profile before adopting it. That check is a plain getDoc() — it must succeed with
  // exists()===false for a genuinely new uid, not throw permission-denied.
  it('an admin CAN read a nonexistent profile — the probe adoptExistingUser depends on', async () => {
    await assertSucceeds(getDoc(doc(await asAdmin(), 'users/never-provisioned')))
  })

  it('a non-admin (even a manager) cannot probe a nonexistent profile', async () => {
    await assertFails(getDoc(doc(await as('manager1', { role: 'manager' }), 'users/never-provisioned')))
    await assertFails(getDoc(doc(await asAgent('agent1'), 'users/never-provisioned')))
  })

  it('an admin in a DIFFERENT org can still only probe existence, not read real data', async () => {
    // resource == null carries no org's data, so the admin-only gate is the only guard —
    // confirm it does not accidentally also expose an EXISTING doc across orgs.
    await seed('users/rival-user', {
      orgId: OTHER_ORG, email: 'x@rival.com', displayName: 'Rival', role: 'agent',
      teamId: 'team-a', isActive: true, createdAt: new Date(), createdBy: 'a',
      updatedAt: new Date(), updatedBy: 'a',
    })
    await assertFails(getDoc(doc(await asAdmin(), 'users/rival-user')))
  })

  it('an unauthenticated visitor cannot probe at all', async () => {
    await assertFails(getDoc(doc(await asAnonymous(), 'users/never-provisioned')))
  })
})

describe('the settings collection no longer carries a bootstrap exception', () => {
  it('an admin can write any settings doc, including one named "bootstrap"', async () => {
    // Confirms the old `docId != 'bootstrap'` carve-out is gone cleanly: nothing in
    // firestore.rules treats that name specially any more, because the collection it
    // protected no longer exists.
    await assertSucceeds(
      setDoc(doc(await asAdmin(), 'settings/bootstrap'), { orgId: ORG, note: 'just a doc now' }),
    )
  })
})
