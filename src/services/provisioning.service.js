/**
 * Creating people, from the browser.
 *
 * ── WHAT A BROWSER CAN AND CANNOT DO ─────────────────────────────────────────
 * It CAN create a Firebase Auth account (`createUserWithEmailAndPassword`) and write the
 * Firestore documents. It CANNOT set a custom claim — `setCustomUserClaims` exists only in
 * the Admin SDK, and there is no client equivalent.
 *
 * That is why `firestore.rules` reads the claim FIRST and falls back to `users/{uid}`: it
 * lets a person created here work immediately, while the `functions/index.js` `onCreate`
 * trigger turns the fallback into the zero-read fast path within moments. `scripts/
 * syncClaims.js` remains a manual backstop for the cases the trigger does not cover — a
 * role change after creation, or repairing a claim that drifted out of sync.
 *
 * ── THE SECONDARY APP ────────────────────────────────────────────────────────
 * `createUserWithEmailAndPassword` signs the new account in on whichever Firebase app it
 * is called against — so calling it on the main app would silently swap the admin's own
 * session for the person they just created. We therefore create a THROWAWAY app instance,
 * create the user on that, and delete it. The admin's session is never touched.
 *
 * ── PASSWORDS ────────────────────────────────────────────────────────────────
 * The temporary password is random, never displayed and never stored. The new person gets
 * a password-reset email and chooses their own. An admin who types a password for someone
 * else has created a credential two people know.
 */

import { initializeApp, deleteApp, getApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getDb, USING_EMULATORS } from '@/firebase/app.js'
import { slugifyOrgId, nextSlugCandidate } from '@/domain/org.js'

/** Roles a person can be given. Mirrors §7.1 and firestore.rules. */
export const ASSIGNABLE_ROLES = Object.freeze(['admin', 'manager', 'finance', 'agent', 'viewer'])

export class ProvisioningError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProvisioningError'
    this.code = code
  }
}

/** Enough entropy that nobody can guess it; nobody ever sees it either. */
function temporaryPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('') + 'Aa1!'
}

/* ──────────────────────────────────────────────────── self-service registration */

/** How many candidate orgIds to try before giving up rather than looping forever. */
const MAX_SLUG_ATTEMPTS = 25

/**
 * Register a brand-new organisation and become its admin.
 *
 * Repeatable — unlike the single-use bootstrap this replaced, any signed-in caller can run
 * this and mint their OWN orgId. Uniqueness is enforced by `orgs/{orgId}` itself: Firestore
 * only allows a `create` write when no document already exists at that path (firestore.rules
 * further pins `resource == null` as the only case `allow create` accepts), so the doc's
 * existence IS the claim — no separate boolean latch is needed the way `settings/bootstrap`
 * needed `claimed`. Two people can never win the same orgId; the loser's transaction sees
 * the doc already there and moves on to the next candidate slug.
 *
 * THREE STEPS, IN THIS ORDER:
 *   1. find a free orgId by trying `orgs/{candidate}` create-only writes until one lands
 *   2. write `users/{uid}` and `usersPublic/{uid}` as that org's admin — separate from step 1
 *      on purpose, because their rules call `get()` on `orgs/{orgId}`, which must already be
 *      committed for `isOrgOwner()` to see it
 *   3. return the winning orgId
 */
export async function registerOrganization({ user, companyName, displayName }) {
  const db = await getDb()
  const base = slugifyOrgId(companyName)

  let orgId = null
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = nextSlugCandidate(base, attempt)
    const orgRef = doc(db, 'orgs', candidate)

    try {
      const won = await runTransaction(db, async (tx) => {
        const snap = await tx.get(orgRef)
        // Both "the doc exists" and "the rules refused even the probing read" mean this
        // candidate is taken — `orgs/{orgId}` is private to its own members (see
        // firestore.rules), so a collision with someone else's org denies the read outright
        // rather than returning an empty snapshot.
        if (snap.exists()) return false
        tx.set(orgRef, {
          orgId: candidate,
          name: companyName?.trim() || candidate,
          ownerUid: user.uid,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        })
        return true
      })
      if (won) {
        orgId = candidate
        break
      }
    } catch {
      // permission-denied on the probing get() — also "taken", try the next candidate.
    }
  }

  if (!orgId) {
    throw new ProvisioningError(
      'org-id-exhausted',
      'Could not find an available organisation identifier. Try a different company name.',
    )
  }

  const now = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', user.uid), {
    orgId,
    email: user.email,
    displayName: displayName?.trim() || user.email,
    role: 'admin',
    teamId: null,
    isActive: true,
    locale: 'sw',
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  })
  batch.set(doc(db, 'usersPublic', user.uid), {
    orgId,
    displayName: displayName?.trim() || user.email,
    photoPath: null,
    isActive: true,
  })
  await batch.commit()

  return { orgId }
}

/* ──────────────────────────────────────────────────────── creating a person */

/**
 * Create a colleague: Auth account, profile, and the redacted mirror.
 *
 * Returns `{ uid, resetEmailSent }`. If the reset email fails the account still exists and
 * is usable — the person can use "Forgot your password?" — so that is reported, not thrown.
 */
export async function createTeamMember({ email, displayName, role, teamId, actor }) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new ProvisioningError('invalid-role', `Unknown role: ${role}`)
  }

  const cleanEmail = email.trim().toLowerCase()
  const db = await getDb()

  // A throwaway app so `createUserWithEmailAndPassword` does not sign the ADMIN out and
  // the new person in. Named uniquely because a name collision would return the existing
  // instance and reintroduce exactly that bug.
  const secondaryName = `provisioning-${Date.now()}`
  let secondary
  try {
    secondary = getApp(secondaryName)
  } catch {
    secondary = initializeApp(getApp().options, secondaryName)
  }

  const secondaryAuth = getAuth(secondary)
  if (USING_EMULATORS) {
    connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  }

  let uid
  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanEmail,
      temporaryPassword(),
    )
    uid = credential.user.uid
  } catch (error) {
    await deleteApp(secondary).catch(() => {})
    if (error?.code === 'auth/email-already-in-use') {
      throw new ProvisioningError('email-taken', 'That email already has an account.')
    }
    if (error?.code === 'auth/invalid-email') {
      throw new ProvisioningError('invalid-email', 'That email address is not valid.')
    }
    throw new ProvisioningError('auth-failed', error?.message ?? 'Could not create the account.')
  }

  // Send the reset link BEFORE tearing the app down, and before signing out.
  let resetEmailSent = false
  try {
    await sendPasswordResetEmail(secondaryAuth, cleanEmail)
    resetEmailSent = true
  } catch {
    // Not fatal — see the docstring.
  }

  await signOut(secondaryAuth).catch(() => {})
  await deleteApp(secondary).catch(() => {})

  // The documents. Written by the ADMIN's session, so the rules see an admin.
  const now = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), {
    orgId: actor.orgId,
    email: cleanEmail,
    displayName: displayName?.trim() || cleanEmail.split('@')[0],
    role,
    teamId: teamId || null,
    isActive: true,
    locale: 'sw',
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  })
  batch.set(doc(db, 'usersPublic', uid), {
    orgId: actor.orgId,
    displayName: displayName?.trim() || cleanEmail.split('@')[0],
    photoPath: null,
    isActive: true,
  })
  await batch.commit()

  return { uid, resetEmailSent }
}

/**
 * Adopt an account that already exists in Firebase Auth but has no profile — the
 * "I made them in the console" case. The uid is copied from the Auth user list.
 */
export async function adoptExistingUser({ uid, email, displayName, role, teamId, actor }) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new ProvisioningError('invalid-role', `Unknown role: ${role}`)
  }
  if (!/^[A-Za-z0-9]{20,128}$/.test(uid.trim())) {
    throw new ProvisioningError('invalid-uid', 'That does not look like a Firebase uid.')
  }

  const db = await getDb()
  const cleanUid = uid.trim()

  const existing = await getDoc(doc(db, 'users', cleanUid))
  if (existing.exists()) {
    throw new ProvisioningError('already-provisioned', 'That user already has a profile.')
  }

  const now = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', cleanUid), {
    orgId: actor.orgId,
    email: email?.trim().toLowerCase() || null,
    displayName: displayName?.trim() || cleanUid,
    role,
    teamId: teamId || null,
    isActive: true,
    locale: 'sw',
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  })
  batch.set(doc(db, 'usersPublic', cleanUid), {
    orgId: actor.orgId,
    displayName: displayName?.trim() || cleanUid,
    photoPath: null,
    isActive: true,
  })
  await batch.commit()

  return { uid: cleanUid }
}
