/**
 * Creating people, from the browser.
 *
 * ── WHAT A BROWSER CAN AND CANNOT DO ─────────────────────────────────────────
 * It CAN create a Firebase Auth account (`createUserWithEmailAndPassword`) and write the
 * Firestore documents. It CANNOT set a custom claim — `setCustomUserClaims` exists only in
 * the Admin SDK, and there is no client equivalent.
 *
 * That is why `firestore.rules` reads the claim FIRST and falls back to `users/{uid}`: it
 * lets a person created here work immediately, while `scripts/syncClaims.js` later turns
 * the fallback into the zero-read fast path.
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
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { getDb, USING_EMULATORS } from '@/firebase/app.js'

export const BOOTSTRAP_DOC = 'settings/bootstrap'

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

/* ────────────────────────────────────────────────────────── bootstrap state */

/**
 * Has the first admin been appointed?
 *
 * Readable by anyone signed in, deliberately: the setup screen has to answer this BEFORE
 * the caller has any role at all. Returns `missing` when the sentinel was never deployed,
 * which is a different problem from "already claimed" and needs a different message.
 */
export async function readBootstrapState() {
  const db = await getDb()
  try {
    const snap = await getDoc(doc(db, BOOTSTRAP_DOC))
    if (!snap.exists()) return { state: 'missing' }
    const data = snap.data()
    return {
      state: data.claimed ? 'claimed' : 'open',
      claimedBy: data.claimedBy ?? null,
      orgId: data.orgId ?? null,
    }
  } catch {
    // Rules deny an unauthenticated read; anything else is a genuine connectivity problem.
    return { state: 'unknown' }
  }
}

/**
 * Take the latch and appoint yourself admin.
 *
 * TWO WRITES, IN THIS ORDER, AND THE ORDER IS THE SAFETY PROPERTY. The transaction claims
 * the sentinel first — permitted only while `claimed == false`, so exactly one caller can
 * win — and only then may that same uid create their own admin profile. A second caller
 * loses at step one and can do nothing at step two.
 */
export async function claimFirstAdmin({ user, displayName }) {
  const db = await getDb()
  const sentinelRef = doc(db, BOOTSTRAP_DOC)

  const orgId = await runTransaction(db, async (tx) => {
    const snap = await tx.get(sentinelRef)
    if (!snap.exists()) {
      throw new ProvisioningError('bootstrap-missing', 'The bootstrap document does not exist.')
    }
    if (snap.data().claimed) {
      throw new ProvisioningError('bootstrap-claimed', 'The first admin has already been set up.')
    }
    tx.update(sentinelRef, {
      claimed: true,
      claimedBy: user.uid,
      claimedAt: serverTimestamp(),
    })
    return snap.data().orgId
  })

  // Separate from the transaction on purpose: the rules for these documents call
  // `get()` on the sentinel, which must already be committed for them to pass.
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

/** Deploy-time helper for the sentinel, used by the seed script. */
export async function openBootstrap(orgId) {
  const db = await getDb()
  await setDoc(doc(db, BOOTSTRAP_DOC), { claimed: false, claimedBy: null, orgId })
}
