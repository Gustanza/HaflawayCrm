/**
 * Admin-invited colleagues, end to end, against the Auth + Firestore + Functions emulators.
 *
 * `registration.integration.test.js` already proves ONE admin-invite path — createTeamMember
 * followed by the automatic claim sync — as a side effect of testing self-registration. What
 * it does NOT cover, and what nothing else in the suite covers either:
 *
 *   - adoptExistingUser(), the "I made the account in the console" path. It writes no Auth
 *     account of its own, so a bug here (wrong uid, wrong org) fails silently — there is no
 *     createUserWithEmailAndPassword() error to catch it.
 *   - that inviting a colleague truly never disturbs the ADMIN'S OWN session. provisioning.
 *     service.js's docstring promises a throwaway secondary app for exactly this reason;
 *     until now nothing asserted `auth.currentUser` was still the admin afterwards.
 *   - that DEACTIVATING a colleague — the write UsersView.vue's toggleActive() makes to
 *     users/{uid} — actually revokes access once an admin runs the sync it tells them to run.
 *     UsersView.vue is explicit that the Firestore write alone changes nothing (TODO.md
 *     §7.1); this test is what confirms the OTHER HALF of that promise — that the documented
 *     recovery step really does finish the job — rather than trusting the code comment.
 *
 * Requires: emulators running (`npm run dev:emulators`, Functions included).
 * Run with: npm run test:integration
 *
 * STATUS: the first test below ("grants a real claim to an account that had NO profile
 * document") currently FAILS. That is not a broken test — it is proof that adoptExistingUser()
 * is non-functional for its primary use case. firestore.rules:296's `/users/{userId}` read
 * rule calls readingMyOrg(), which dereferences `resource.data`; for a uid with no profile
 * yet, `resource` is null in a Firestore security rule, so the existence-check getDoc() inside
 * adoptExistingUser() (provisioning.service.js:253) throws permission-denied instead of
 * returning exists()===false. Left failing deliberately so a fix flips it green — see the
 * test-runner's report for the full trace.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, getDb } from '@/firebase/app.js'

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'

let adminAuth
let adminDb

beforeAll(async () => {
  const { initializeApp, deleteApp, getApps } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const { getFirestore } = await import('firebase-admin/firestore')
  const existing = getApps().find((a) => a.name === 'admin-invite-integration-admin')
  if (existing) await deleteApp(existing)
  const adminApp = initializeApp({ projectId: 'haflawaycrm' }, 'admin-invite-integration-admin')
  adminAuth = getAuth(adminApp)
  adminDb = getFirestore(adminApp)
})

afterEach(async () => {
  await signOut(auth).catch(() => {})
})

function uniqueEmail(label) {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

/** Poll an admin-only view of a uid's custom claims, exactly like registration.integration.test.js. */
async function waitForAdminClaims(uid, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const userRecord = await adminAuth.getUser(uid)
    const claims = userRecord.customClaims ?? {}
    if (claims.role) return claims
    if (Date.now() > deadline) {
      throw new Error(`Claims never synced for uid ${uid} within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * The exact logic scripts/syncClaims.js runs for one user — reproduced here (not shelled
 * out to the script) so the test can target a single freshly-created uid without touching
 * every other seeded account sharing this emulator.
 */
async function syncOneClaim(uid) {
  const snap = await adminDb.doc(`users/${uid}`).get()
  const profile = snap.data()
  const next = {
    role: profile.role,
    teamId: profile.teamId ?? null,
    orgId: profile.orgId,
    active: profile.isActive !== false,
  }
  await adminAuth.setCustomUserClaims(uid, next)
  const shouldBeDisabled = next.active === false
  await adminAuth.updateUser(uid, { disabled: shouldBeDisabled })
  if (shouldBeDisabled) await adminAuth.revokeRefreshTokens(uid)
  return next
}

async function makeAdmin(label) {
  const { registerOrganization } = await import('../../src/services/provisioning.service.js')
  const email = uniqueEmail(label)
  const credential = await createUserWithEmailAndPassword(auth, email, 'Sup3rSecret!')
  const { orgId } = await registerOrganization({
    user: { uid: credential.user.uid, email },
    companyName: `${label} Co`,
    displayName: 'Admin',
  })
  await waitForAdminClaims(credential.user.uid)
  return { uid: credential.user.uid, email, orgId }
}

describe('adoptExistingUser: the "made in the console" path', () => {
  it('grants a real claim to an account that had NO profile document', async () => {
    const { adoptExistingUser } = await import('../../src/services/provisioning.service.js')
    const admin = await makeAdmin('adopt-admin')

    // The console-made account: an Auth user with no users/{uid} document at all — created
    // directly against Auth, the way a human would in the Firebase console.
    const consoleEmail = uniqueEmail('console-made')
    const consoleCred = await adminAuth.createUser({ email: consoleEmail, password: 'Sup3rSecret!' })

    await signInWithEmailAndPassword(auth, admin.email, 'Sup3rSecret!')

    await adoptExistingUser({
      uid: consoleCred.uid,
      email: consoleEmail,
      displayName: 'Adopted Person',
      role: 'manager',
      teamId: 'team-dar',
      actor: { uid: admin.uid, orgId: admin.orgId },
    })

    const db = await getDb()
    const profile = await getDoc(doc(db, 'users', consoleCred.uid))
    expect(profile.exists()).toBe(true)
    expect(profile.data().role).toBe('manager')
    expect(profile.data().orgId).toBe(admin.orgId)
    expect(profile.data().teamId).toBe('team-dar')

    // Same onCreate trigger fires for an adopted profile as for a freshly-created one — the
    // adopted person should not be stuck on the document fallback any longer than a normal
    // invite would be.
    const claims = await waitForAdminClaims(consoleCred.uid)
    expect(claims.role).toBe('manager')
    expect(claims.orgId).toBe(admin.orgId)
    expect(claims.active).toBe(true)
  })

  it('refuses to adopt a uid that already has a profile — the error the UI maps to setup.errorAlreadyProvisioned', async () => {
    const { adoptExistingUser } = await import('../../src/services/provisioning.service.js')
    const admin = await makeAdmin('adopt-dup-admin')

    const consoleEmail = uniqueEmail('already-provisioned')
    const consoleCred = await adminAuth.createUser({ email: consoleEmail, password: 'Sup3rSecret!' })
    await adminDb.doc(`users/${consoleCred.uid}`).set({
      orgId: admin.orgId, email: consoleEmail, displayName: 'Already Here',
      role: 'agent', teamId: null, isActive: true, locale: 'sw',
    })

    await signInWithEmailAndPassword(auth, admin.email, 'Sup3rSecret!')

    await expect(
      adoptExistingUser({
        uid: consoleCred.uid,
        email: consoleEmail,
        displayName: 'Attempted Re-adopt',
        role: 'manager',
        teamId: null,
        actor: { uid: admin.uid, orgId: admin.orgId },
      }),
    ).rejects.toMatchObject({ code: 'already-provisioned' })
  })
})

describe('createTeamMember does not disturb the inviting admin\'s own session', () => {
  it('leaves auth.currentUser pointed at the admin, not the newly created colleague', async () => {
    const { createTeamMember } = await import('../../src/services/provisioning.service.js')
    const admin = await makeAdmin('session-admin')

    await signInWithEmailAndPassword(auth, admin.email, 'Sup3rSecret!')
    expect(auth.currentUser.uid).toBe(admin.uid)

    const colleagueEmail = uniqueEmail('colleague-session')
    const { uid: colleagueUid } = await createTeamMember({
      email: colleagueEmail,
      displayName: 'Colleague',
      role: 'agent',
      teamId: null,
      actor: { uid: admin.uid, orgId: admin.orgId },
    })

    // The whole point of the throwaway secondary app: creating someone else's Auth account
    // must never sign the caller out of their own.
    expect(auth.currentUser).not.toBeNull()
    expect(auth.currentUser.uid).toBe(admin.uid)
    expect(auth.currentUser.uid).not.toBe(colleagueUid)

    // And the session is not just "an object that still says admin" — it can still write
    // as the admin afterwards.
    const db = await getDb()
    const profile = await getDoc(doc(db, 'users', admin.uid))
    expect(profile.exists()).toBe(true)
    expect(profile.data().role).toBe('admin')
  })
})

describe('deactivating a colleague actually revokes access, once synced', () => {
  it('the UsersView.vue write alone changes nothing; syncing is what finishes the job', async () => {
    const { createTeamMember } = await import('../../src/services/provisioning.service.js')
    const admin = await makeAdmin('deactivate-admin')

    await signInWithEmailAndPassword(auth, admin.email, 'Sup3rSecret!')
    const colleagueEmail = uniqueEmail('soon-deactivated')
    const { uid: colleagueUid } = await createTeamMember({
      email: colleagueEmail,
      displayName: 'Soon Deactivated',
      role: 'agent',
      teamId: null,
      actor: { uid: admin.uid, orgId: admin.orgId },
    })
    await waitForAdminClaims(colleagueUid)
    await signOut(auth)

    // The colleague's real password is random and never exposed (see createTeamMember's
    // docstring) — so set a known one via the Admin SDK, exactly as if they had completed
    // the password-reset email flow, then sign in as them to establish the baseline: active,
    // before deactivation.
    await adminAuth.updateUser(colleagueUid, { password: 'Sup3rSecret!' })
    const signedIn = await signInWithEmailAndPassword(auth, colleagueEmail, 'Sup3rSecret!')
    expect(signedIn.user.uid).toBe(colleagueUid)
    const claimsBefore = await signedIn.user.getIdTokenResult(true)
    expect(claimsBefore.claims.active).toBe(true)
    await signOut(auth)

    // Exactly the write UsersView.vue's toggleActive() makes: patch(user, { isActive: false }, …)
    // — done here as the admin, through the real rules, not a rules-disabled seed().
    await signInWithEmailAndPassword(auth, admin.email, 'Sup3rSecret!')
    const db = await getDb()
    const { updateDoc, serverTimestamp } = await import('firebase/firestore')
    await updateDoc(doc(db, 'users', colleagueUid), {
      isActive: false,
      updatedAt: serverTimestamp(),
      updatedBy: admin.uid,
    })
    await signOut(auth)

    // Per TODO.md §7.1 and UsersView.vue's own on-screen warning: the write alone does NOT
    // revoke access, because the CLAIM — not the document — is what the rules and Auth
    // sign-in check. The colleague can still sign in right now.
    const stillSignedIn = await signInWithEmailAndPassword(auth, colleagueEmail, 'Sup3rSecret!')
    expect(stillSignedIn.user.uid).toBe(colleagueUid)
    await signOut(auth)

    // Running the sync — what the amber banner tells the admin to do — is what finishes it:
    // claim cleared, Auth account disabled, refresh tokens revoked.
    const synced = await syncOneClaim(colleagueUid)
    expect(synced.active).toBe(false)

    const userRecord = await adminAuth.getUser(colleagueUid)
    expect(userRecord.disabled).toBe(true)

    // Now sign-in itself is refused — the account is disabled, not just the claim cleared.
    await expect(
      signInWithEmailAndPassword(auth, colleagueEmail, 'Sup3rSecret!'),
    ).rejects.toMatchObject({ code: expect.stringMatching(/user-disabled|invalid-credential/) })
  })
})
