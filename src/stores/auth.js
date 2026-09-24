/**
 * Authentication and authorisation state.
 *
 * TODO.md §7.1: the custom claim is the AUTHORITY for permissions — it is what
 * firestore.rules evaluates. The users/{uid} document carries the richer profile the UI
 * needs (targets, photo, team name). If the two ever disagree, the claim wins, and
 * scripts/syncClaims.js is what repairs the document.
 *
 * Consequence for the UI: never gate a security-relevant action on the profile document.
 * Gate it on `claims`, and let the rules reject anything that slips through anyway.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import { auth, getDb } from '@/firebase/app.js'
import { useUiStore } from '@/stores/ui.js'

export const ROLES = Object.freeze(['admin', 'manager', 'agent'])

/** Human-readable messages for the Firebase error codes users actually hit. */
const AUTH_ERRORS = {
  'auth/invalid-email': 'auth.error.invalidEmail',
  'auth/user-disabled': 'auth.error.disabled',
  'auth/user-not-found': 'auth.error.invalidCredentials',
  'auth/wrong-password': 'auth.error.invalidCredentials',
  'auth/invalid-credential': 'auth.error.invalidCredentials',
  'auth/too-many-requests': 'auth.error.tooManyAttempts',
  'auth/network-request-failed': 'auth.error.network',
  'auth/requires-recent-login': 'auth.error.requiresRecentLogin',
  'auth/email-already-in-use': 'auth.error.emailInUse',
  'auth/weak-password': 'auth.error.weakPassword',
}

export function authErrorKey(error) {
  return AUTH_ERRORS[error?.code] ?? 'auth.error.generic'
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null) // Firebase Auth user
  const claims = ref(null) // custom claims — the authority
  const profile = ref(null) // users/{uid} document
  const initialising = ref(true) // true until the first auth state resolves
  const busy = ref(false)
  const errorKey = ref(null)

  let stopProfileListener = null
  let initPromise = null
  // The in-flight application of the latest auth state. Navigation awaits it so the router
  // never sees a half-applied session: signed in, but with no claims read yet.
  let settling = Promise.resolve()
  let authSeq = 0

  /* ---------------------------------------------------------------- getters */

  const isSignedIn = computed(() => user.value !== null)
  const uid = computed(() => user.value?.uid ?? null)
  const role = computed(() => claims.value?.role ?? null)
  const teamId = computed(() => claims.value?.teamId ?? null)
  const orgId = computed(() => claims.value?.orgId ?? null)

  /**
   * A signed-in user whose claims have not been provisioned is NOT usable: every rule
   * denies them. The UI must send them to a "waiting for access" screen rather than an
   * app shell full of permission errors.
   */
  const isProvisioned = computed(
    () => ROLES.includes(role.value) && Boolean(orgId.value?.trim()),
  )
  const isActive = computed(() => claims.value?.active === true)
  const canUseApp = computed(() => isSignedIn.value && isProvisioned.value && isActive.value)

  const displayName = computed(
    () => profile.value?.displayName || user.value?.email?.split('@')[0] || '',
  )

  const isAdmin = computed(() => role.value === 'admin')
  const isManager = computed(() => role.value === 'admin' || role.value === 'manager')
  const isAgent = computed(() => role.value === 'agent')

  /** Mirrors firestore.rules §4. Keep the two in step. */
  const can = computed(() => ({
    createLead: ['admin', 'manager', 'agent'].includes(role.value),
    reassignLead: isManager.value,
    manageUsers: isAdmin.value,
    editSettings: isAdmin.value,
    viewAllLeads: isAdmin.value,
    viewTeamLeads: isManager.value,
    // Admin ONLY, never manager. This is the one irreversible action in the product: it
    // destroys the timeline and releases the phone lock. A manager reassigns and closes
    // leads; they do not get to erase one.
    deleteLead: isAdmin.value,
  }))

  /* ---------------------------------------------------------------- actions */

  /**
   * Watch the profile document.
   *
   * Async because Firestore is loaded lazily (see firebase/app.js) — the login screen
   * must not pay for the SDK. A sign-out that lands between the import starting and
   * finishing is handled by the `cancelled` guard: without it, a stale listener would
   * attach for a user who has already left.
   */
  async function watchProfile(currentUid) {
    stopProfileListener?.()
    let cancelled = false
    stopProfileListener = () => {
      cancelled = true
    }

    const [db, { doc, onSnapshot }] = await Promise.all([getDb(), import('firebase/firestore')])
    if (cancelled || user.value?.uid !== currentUid) return

    const ui = useUiStore()
    const source = ui.connectivitySource()
    const unsubscribeSnapshot = onSnapshot(
      doc(db, 'users', currentUid),
      { includeMetadataChanges: true },
      (snap) => {
        // The profile listener is the only listener guaranteed to be alive for the whole
        // session, which makes it the right place to sample real connectivity. Without a
        // caller, `reportSnapshot` was dead code and `firestoreServed` could only ever be
        // set false — the banner latched on "offline" for the rest of the session.
        ui.reportSnapshot(snap, source)
        profile.value = snap.exists() ? { id: snap.id, ...snap.data() } : null
      },
      () => {
        // An unprovisioned user cannot read their own document yet. Not an error worth
        // showing — `isProvisioned` already routes them to the waiting screen.
        ui.releaseSource(source)
        profile.value = null
      },
    )
    stopProfileListener = () => {
      unsubscribeSnapshot()
      ui.releaseSource(source)
    }
  }

  const claimsGrantAccess = (c) =>
    ROLES.includes(c?.role) && Boolean(c?.orgId?.trim()) && c?.active === true

  /**
   * Read the claims, fast when possible and NEVER depending on the network.
   *
   * The cached token is used when it already grants access — that is instant, and blocking
   * on a forced refresh here is part of what left a freshly signed-in user looking
   * "unprovisioned". Only when the cached claims fall short do we pay for a server refresh
   * (a role granted seconds ago). Offline that refresh fails, and the cached token — which
   * Firebase persists and which is what the SDK would send anyway — is good enough.
   */
  async function readClaims(fbUser) {
    const fallback = user.value?.uid === fbUser.uid ? claims.value : null
    let cached = null
    try {
      cached = (await fbUser.getIdTokenResult(false)).claims
    } catch {
      /* fall through to a refresh */
    }
    if (claimsGrantAccess(cached)) return cached
    try {
      return (await fbUser.getIdTokenResult(true)).claims
    } catch {
      // Keep whatever we already had rather than downgrading a working session to
      // "unprovisioned" because the phone lost signal.
      return cached ?? fallback
    }
  }

  /**
   * Pick up role changes made since the cached token was issued, without blocking anything.
   * Silent on failure: this is a background top-up, not something the user asked for.
   */
  async function refreshClaimsQuietly(fbUser) {
    try {
      const fresh = (await fbUser.getIdTokenResult(true)).claims
      if (user.value?.uid === fbUser.uid) claims.value = fresh
    } catch {
      /* offline — the cached claims stand */
    }
  }

  /**
   * Apply an auth state. `user` and `claims` are set TOGETHER, after the claims are read:
   * setting the user first let the router see "signed in, no role" mid-login and bounce a
   * perfectly good account to the no-access screen.
   */
  async function applyAuthUser(fbUser) {
    const seq = ++authSeq
    if (!fbUser) {
      stopProfileListener?.()
      stopProfileListener = null
      user.value = null
      claims.value = null
      profile.value = null
      return
    }
    const nextClaims = await readClaims(fbUser)
    if (seq !== authSeq) return // a newer sign-in or sign-out overtook this one
    const changedUser = user.value?.uid !== fbUser.uid
    claims.value = nextClaims
    user.value = fbUser
    if (changedUser || !stopProfileListener) watchProfile(fbUser.uid)
    refreshClaimsQuietly(fbUser)
  }

  /**
   * Resolve the current auth state exactly once, then keep it live.
   * Router guards await this, so it MUST always settle — including offline, including
   * when the token endpoint is unreachable. If it does not, `initialising` stays true and
   * the whole app hangs on a spinner with no route ever rendering (TODO.md P7, P8).
   */
  function init() {
    if (initPromise) return initPromise
    initPromise = new Promise((resolve) => {
      let resolved = false
      const finish = () => {
        if (resolved) return
        resolved = true
        // Whatever happened, the app must become navigable.
        initialising.value = false
        resolve(user.value)
      }
      onAuthStateChanged(
        auth,
        (fbUser) => {
          settling = applyAuthUser(fbUser).catch(() => {}).finally(finish)
        },
        // The observer itself errored. Still let the app boot — the router will send an
        // unauthenticated user to /login, which is a screen, not a spinner.
        finish,
      )
    })
    return initPromise
  }

  /** Wait until the latest auth state has been fully applied. Cheap once settled. */
  async function ready() {
    await init()
    await settling
  }

  /** After a sign-in: make sure THIS user is applied before anyone navigates. */
  async function settleFor(fbUser) {
    await settling
    if (user.value?.uid !== fbUser.uid) {
      settling = applyAuthUser(fbUser).catch(() => {})
      await settling
    }
  }

  async function signIn(email, password) {
    busy.value = true
    errorKey.value = null
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
      await settleFor(credential.user)
      return true
    } catch (error) {
      errorKey.value = authErrorKey(error)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * Self-registration. Unlike `createTeamMember` in provisioning.service.js (which uses a
   * throwaway secondary app so it never disturbs the ADMIN's own session), this call is
   * meant to sign the caller in as themselves — there is no other session to protect.
   */
  async function registerAccount(email, password) {
    busy.value = true
    errorKey.value = null
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      await settleFor(credential.user)
      return true
    } catch (error) {
      errorKey.value = authErrorKey(error)
      return false
    } finally {
      busy.value = false
    }
  }

  async function signOut() {
    authSeq++ // cancel any sign-in still reading its claims
    stopProfileListener?.()
    stopProfileListener = null
    await fbSignOut(auth)
    user.value = null
    claims.value = null
    profile.value = null
  }

  async function resetPassword(email) {
    busy.value = true
    errorKey.value = null
    try {
      await sendPasswordResetEmail(auth, email.trim())
      return true
    } catch (error) {
      // Deliberately do NOT surface "user-not-found": that would let anyone probe which
      // email addresses belong to staff. The UI shows the same confirmation either way.
      if (error?.code === 'auth/user-not-found') return true
      errorKey.value = authErrorKey(error)
      return false
    } finally {
      busy.value = false
    }
  }

  async function changePassword(currentPassword, newPassword) {
    busy.value = true
    errorKey.value = null
    try {
      const credential = EmailAuthProvider.credential(user.value.email, currentPassword)
      await reauthenticateWithCredential(user.value, credential)
      await updatePassword(user.value, newPassword)
      return true
    } catch (error) {
      errorKey.value = authErrorKey(error)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * Pick up a role change without a full sign-out.
   *
   * Returns true when the claims were genuinely refreshed from the server, false when we
   * could not reach it. The caller needs to know the difference: on the no-access screen,
   * silently "succeeding" offline would leave the user staring at the same dead end with
   * no idea why nothing changed.
   */
  async function refreshClaims() {
    if (!user.value) return false
    try {
      const token = await user.value.getIdTokenResult(true)
      claims.value = token.claims
      return true
    } catch (error) {
      errorKey.value = authErrorKey(error)
      return false
    }
  }

  function clearError() {
    errorKey.value = null
  }

  return {
    user, claims, profile, initialising, busy, errorKey,
    isSignedIn, uid, role, teamId, orgId, isProvisioned, isActive, canUseApp,
    displayName, isAdmin, isManager, isAgent, can,
    init, ready, signIn, registerAccount, signOut, resetPassword, changePassword, refreshClaims,
    clearError,
  }
})
