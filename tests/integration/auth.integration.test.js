/**
 * Sign-in, end to end, against the Auth + Firestore emulators.
 *
 * This is the flow every one of 50 staff runs several times a day, and until now nothing
 * exercised it: the unit tests never touch Firebase, and the rules tests inject claims
 * directly rather than signing anybody in. So the actual question — "does
 * agent1@haflaway.com / haflaway123 get into the app?" — had no answer.
 *
 * What this covers that the other suites cannot:
 *   - a real password check against the Auth emulator
 *   - the custom claims that `syncClaims` / `seed` actually wrote
 *   - the `canUseApp` gate (§7.1) recomputed from those real claims
 *   - the users/{uid} profile read succeeding under the REAL security rules
 *   - a deactivated account being refused
 *
 * Requires: emulators running (`npm run dev:emulators`) and `npm run seed`.
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
} from 'firebase/firestore'

/**
 * A denied LIST does not say "permission denied" — the emulator reports the rule that
 * failed to evaluate, e.g. "false for 'list' @ L295". Assert on the rejection itself.
 */
async function expectDenied(promise, label) {
  let denied = false
  try {
    await promise
  } catch {
    denied = true
  }
  expect(denied, `${label} should have been denied by the rules, but succeeded`).toBe(true)
}

const PASSWORD = 'haflaway123'
const ORG = 'haflaway'

let app
let auth
let db

beforeAll(() => {
  app = initializeApp({ projectId: 'haflawaycrm', apiKey: 'emulator-key' }, 'auth-integration')
  auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
})

afterAll(async () => {
  await signOut(auth).catch(() => {})
  await deleteApp(app)
})

/** Mirrors the getters in src/stores/auth.js, computed from the REAL token. */
function gate(claims) {
  const ROLES = ['admin', 'manager', 'finance', 'agent', 'viewer']
  const isProvisioned = ROLES.includes(claims.role) && Boolean(claims.orgId?.trim())
  const isActive = claims.active === true
  return { isProvisioned, isActive, canUseApp: isProvisioned && isActive }
}

async function signInAs(email) {
  const credential = await signInWithEmailAndPassword(auth, email, PASSWORD)
  const token = await credential.user.getIdTokenResult(true)
  return { user: credential.user, claims: token.claims }
}

describe('the seeded accounts can actually sign in', () => {
  const accounts = [
    ['admin@haflaway.com', 'admin'],
    ['finance@haflaway.com', 'finance'],
    ['manager.dar@haflaway.com', 'manager'],
    ['agent1@haflaway.com', 'agent'],
    ['viewer@haflaway.com', 'viewer'],
  ]

  it.each(accounts)('%s signs in and is granted the %s role', async (email, role) => {
    const { user, claims } = await signInAs(email)

    expect(user.email).toBe(email)
    expect(claims.role, `${email} has no role claim — run: npm run claims`).toBe(role)
    expect(claims.orgId).toBe(ORG)
    expect(claims.active).toBe(true)

    // The gate that decides whether they see the app or the "no access" screen.
    expect(gate(claims).canUseApp, `${email} would land on /no-access`).toBe(true)

    await signOut(auth)
  })
})

describe('a signed-in user can read their own profile under the real rules', () => {
  it('agent1 reads users/{uid} and gets a usable display name', async () => {
    const { user } = await signInAs('agent1@haflaway.com')

    const snap = await getDoc(doc(db, 'users', user.uid))
    expect(snap.exists(), 'profile document missing — run: npm run seed').toBe(true)

    const profile = snap.data()
    expect(profile.displayName).toBeTruthy()
    expect(profile.role).toBe('agent')
    expect(profile.orgId).toBe(ORG)
    // §13: Swahili is the default.
    expect(profile.locale).toBe('sw')

    await signOut(auth)
  })
})

describe('an agent sees their own pipeline and nothing else', () => {
  it('reads leads they own', async () => {
    const { user } = await signInAs('agent1@haflaway.com')

    // orgId is REQUIRED on every list: the rule reads it, so the query must constrain it.
    // See src/services/queries.js — without it this is rejected outright.
    const mine = await getDocs(
      query(
        collection(db, 'leads'),
        where('orgId', '==', ORG),
        where('ownerId', '==', user.uid),
        limit(5),
      ),
    )
    expect(mine.empty, 'agent1 owns no seeded leads — run: npm run seed').toBe(false)
    for (const d of mine.docs) expect(d.data().ownerId).toBe(user.uid)

    await signOut(auth)
  })

  it('is refused a colleague pipeline by the rules, not by the UI', async () => {
    await signInAs('agent1@haflaway.com')
    // §7.1: an agent must not read another agent's leads.
    await expectDenied(
      getDocs(
        query(
          collection(db, 'leads'),
          where('orgId', '==', ORG),
          where('ownerId', '==', 'u-agent-2'),
          limit(1),
        ),
      ),
      "agent1 listing agent2's leads",
    )

    await signOut(auth)
  })

  it('is refused every cost collection', async () => {
    await signInAs('agent1@haflaway.com')

    await expectDenied(
      getDocs(query(collection(db, 'expenses'), where('orgId', '==', ORG), limit(1))),
      'agent listing expenses',
    )
    await expectDenied(
      getDocs(query(collection(db, 'campaigns'), where('orgId', '==', ORG), limit(1))),
      'agent listing campaigns',
    )
    // …but the redacted mirror is readable, which is what lead attribution needs.
    const publicCampaigns = await getDocs(
      query(collection(db, 'campaignsPublic'), where('orgId', '==', ORG), limit(1)),
    )
    expect(publicCampaigns.empty).toBe(false)

    await signOut(auth)
  })
})

describe('finance sees the money, agents do not', () => {
  it('finance reads expenses and campaigns', async () => {
    await signInAs('finance@haflaway.com')

    const expenses = await getDocs(
      query(collection(db, 'expenses'), where('orgId', '==', ORG), limit(3)),
    )
    expect(expenses.empty).toBe(false)

    const campaigns = await getDocs(
      query(collection(db, 'campaigns'), where('orgId', '==', ORG), limit(3)),
    )
    expect(campaigns.empty).toBe(false)

    await signOut(auth)
  })
})

describe('bad credentials are refused', () => {
  it('rejects a wrong password', async () => {
    await expect(
      signInWithEmailAndPassword(auth, 'agent1@haflaway.com', 'wrong-password'),
    ).rejects.toMatchObject({ code: expect.stringMatching(/invalid-credential|wrong-password/) })
  })

  it('rejects an unknown account', async () => {
    await expect(
      signInWithEmailAndPassword(auth, 'nobody@haflaway.com', PASSWORD),
    ).rejects.toMatchObject({ code: expect.stringMatching(/invalid-credential|user-not-found/) })
  })

  it('refuses a deactivated staff member', async () => {
    // The seed disables this account deliberately, so the path stays testable.
    await expect(
      signInWithEmailAndPassword(auth, 'exstaff@haflaway.com', PASSWORD),
    ).rejects.toMatchObject({ code: expect.stringMatching(/user-disabled|invalid-credential/) })
  })
})

describe('the error map covers what users actually hit', () => {
  it('maps a wrong password to a human message, not a Firebase code', async () => {
    const { authErrorKey } = await import('../../src/stores/auth.js')
    try {
      await signInWithEmailAndPassword(auth, 'agent1@haflaway.com', 'wrong-password')
      throw new Error('should not have signed in')
    } catch (error) {
      const key = authErrorKey(error)
      expect(key).toBe('auth.error.invalidCredentials')
      expect(key).not.toContain('auth/')
    }
  })

  it('maps a disabled account to its own message', async () => {
    const { authErrorKey } = await import('../../src/stores/auth.js')
    try {
      await signInWithEmailAndPassword(auth, 'exstaff@haflaway.com', PASSWORD)
      throw new Error('should not have signed in')
    } catch (error) {
      // Firebase reports either user-disabled or the generic invalid-credential depending
      // on the emulator's email-enumeration-protection setting; both must be human.
      expect(['auth.error.disabled', 'auth.error.invalidCredentials']).toContain(
        authErrorKey(error),
      )
    }
  })
})
