/**
 * Self-registration, end to end, against the Auth + Firestore + Functions emulators.
 *
 * This is the one path the other integration suites cannot exercise: `auth.integration.test.js`
 * signs in as accounts the SEED SCRIPT already created with the Admin SDK (a trusted,
 * out-of-band path), and `queries.integration.test.js`/`analytics.integration.test.js` never
 * create an account at all. Nothing until this file has actually driven a brand-new signup
 * through the real browser-side flow: create the Auth account, mint a new org, and wait for
 * `functions/index.js`'s `syncClaimsOnUserCreate` trigger to turn the rules' document
 * fallback into a real custom claim — the exact thing a browser cannot do for itself.
 *
 * Uses the app's OWN `@/firebase/app.js` singleton for auth/db, exactly like RegisterView.vue
 * and provisioning.service.js do — NOT a separately-initialized Firebase app. registerOrganization()
 * calls `getDb()` internally, which is tied to this one shared app instance; authenticating on
 * a different named app (as an earlier draft of this file did) leaves that shared instance
 * signed out, and every write it attempts is then evaluated as an anonymous caller.
 *
 * Requires: emulators running (`npm run dev:emulators`, which now also starts the Functions
 * emulator). Run with: npm run test:integration
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore'
import { auth, getDb } from '@/firebase/app.js'

// Inspecting a uid's custom claims without signing in as it (its temp password is random
// and never exposed — see createTeamMember() in provisioning.service.js) needs an ADMIN
// view of the Auth emulator. firebase-admin, pointed at the emulator exactly the way
// scripts/syncClaims.js already does, is the correct tool for that — not a hand-rolled
// guess at the emulator's undocumented REST shape.
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
let adminAuth

beforeAll(async () => {
  const { initializeApp, deleteApp, getApps } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const existing = getApps().find((a) => a.name === 'registration-integration-admin')
  if (existing) await deleteApp(existing)
  const adminApp = initializeApp({ projectId: 'haflawaycrm' }, 'registration-integration-admin')
  adminAuth = getAuth(adminApp)
})

afterEach(async () => {
  await signOut(auth).catch(() => {})
})

/**
 * The Cloud Function fires asynchronously, even against the emulator — a fresh registration
 * does NOT have real claims the instant the Firestore write resolves. Poll rather than
 * assume a fixed delay, so this is fast on a quiet machine and still passes on a loaded one.
 */
async function waitForClaims(user, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const token = await user.getIdTokenResult(true)
    if (token.claims.role) return token.claims
    if (Date.now() > deadline) {
      throw new Error(`Claims never synced for ${user.email} within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** Poll an admin-only view of a uid's custom claims — the only way to observe them for an
 *  account this test never signs in as. */
async function waitForAdminClaims(uid, expected, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const userRecord = await adminAuth.getUser(uid)
    const claims = userRecord.customClaims ?? {}
    if (claims.role) {
      expect(claims.role).toBe(expected.role)
      expect(claims.orgId).toBe(expected.orgId)
      return claims
    }
    if (Date.now() > deadline) {
      throw new Error(`Claims never synced for uid ${uid} within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function uniqueEmail(label) {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

describe('a brand-new signup becomes admin of its own org, end to end', () => {
  it('gets a real admin claim once the Cloud Function has run', async () => {
    const { registerOrganization } = await import('../../src/services/provisioning.service.js')

    const email = uniqueEmail('founder')
    const credential = await createUserWithEmailAndPassword(auth, email, 'Sup3rSecret!')
    const user = credential.user

    const { orgId } = await registerOrganization({
      user: { uid: user.uid, email },
      companyName: 'Registration Test Co',
      displayName: 'Founder',
    })

    expect(orgId).toMatch(/^[a-z0-9-]{2,40}$/)

    const claims = await waitForClaims(user)
    expect(claims.role).toBe('admin')
    expect(claims.orgId).toBe(orgId)
    expect(claims.active).toBe(true)

    // The claim is real, not the document fallback — the profile itself must also agree,
    // since that is what the UI renders and what a stale reader would fall back to.
    const db = await getDb()
    const profile = await getDoc(doc(db, 'users', user.uid))
    expect(profile.exists()).toBe(true)
    expect(profile.data().role).toBe('admin')
    expect(profile.data().orgId).toBe(orgId)

    // A real admin claim means this account can now read data scoped to ITS org under the
    // real rules — not the fallback path exercised by the rules-emulator suite.
    const leads = await getDocs(
      query(collection(db, 'leads'), where('orgId', '==', orgId), limit(1)),
    )
    expect(leads.empty).toBe(true) // a fresh org has no leads yet, but the query itself must not be denied
  })

  it('two different signups with the SAME company name land in two different, isolated orgs', async () => {
    const { registerOrganization } = await import('../../src/services/provisioning.service.js')

    const emailA = uniqueEmail('twin-a')
    const credA = await createUserWithEmailAndPassword(auth, emailA, 'Sup3rSecret!')
    const { orgId: orgA } = await registerOrganization({
      user: { uid: credA.user.uid, email: emailA },
      companyName: 'Twin Company',
      displayName: 'Twin A',
    })
    await signOut(auth)

    const emailB = uniqueEmail('twin-b')
    const credB = await createUserWithEmailAndPassword(auth, emailB, 'Sup3rSecret!')
    const { orgId: orgB } = await registerOrganization({
      user: { uid: credB.user.uid, email: emailB },
      companyName: 'Twin Company',
      displayName: 'Twin B',
    })

    // The core new capability this whole feature exists for: repeatable, not one-shot.
    expect(orgA).not.toBe(orgB)

    const claimsB = await waitForClaims(credB.user)
    expect(claimsB.orgId).toBe(orgB)
  })

  it('self-registered admin can invite a colleague, who also gets synced claims automatically', async () => {
    const { registerOrganization, createTeamMember } = await import(
      '../../src/services/provisioning.service.js'
    )

    const adminEmail = uniqueEmail('admin')
    const adminCred = await createUserWithEmailAndPassword(auth, adminEmail, 'Sup3rSecret!')
    const { orgId } = await registerOrganization({
      user: { uid: adminCred.user.uid, email: adminEmail },
      companyName: 'Colleague Co',
      displayName: 'Admin',
    })
    await waitForClaims(adminCred.user)

    const colleagueEmail = uniqueEmail('colleague')
    const { uid: colleagueUid } = await createTeamMember({
      email: colleagueEmail,
      displayName: 'Colleague',
      role: 'agent',
      teamId: null,
      actor: { uid: adminCred.user.uid, orgId },
    })

    // createTeamMember uses a THROWAWAY secondary app internally, so the admin's own session
    // on the shared app (asserted above) is untouched by creating this colleague.
    const db = await getDb()
    const profile = await getDoc(doc(db, 'users', colleagueUid))
    expect(profile.exists()).toBe(true)
    expect(profile.data().role).toBe('agent')
    expect(profile.data().orgId).toBe(orgId)

    await waitForAdminClaims(colleagueUid, { role: 'agent', orgId })
  })
})
