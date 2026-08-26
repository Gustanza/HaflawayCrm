/**
 * Server-side claim sync — the piece a browser genuinely cannot do itself.
 *
 * `setCustomUserClaims` is Admin SDK only (see src/services/provisioning.service.js's
 * docstring). Until this trigger existed, the ONLY way to turn a `users/{uid}` profile into
 * a real custom claim was a human running `scripts/syncClaims.js` by hand. That made
 * self-registration a half-feature: the org and profile could be created from the browser,
 * but nothing ever converted the fallback into the fast path unless somebody remembered to
 * run a script.
 *
 * This fires automatically on every new `users/{uid}` document — both from
 * registerOrganization() (self-registration) and from createTeamMember()/adoptExistingUser()
 * (admin-invited colleagues), which is a welcome side effect: colleagues invited from the
 * Setup screen now get their fast-path claim within moments too, not just at whatever
 * cadence `npm run claims` happens to run.
 *
 * `scripts/syncClaims.js` remains the tool for everything this trigger does NOT cover: a
 * role change on an EXISTING profile (no create event fires), or repairing a claim that
 * drifted out of sync.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'

initializeApp()

const VALID_ROLES = ['admin', 'manager', 'finance', 'agent', 'viewer']

/**
 * Must be kept in sync with ORG_ID_PATTERN in src/domain/org.js, firestore.rules and
 * scripts/syncClaims.js. orgId is the prefix of the leadPhoneIndex/{orgId}_{phone} key —
 * an underscore here would corrupt that split.
 */
const ORG_ID_PATTERN = /^[a-z0-9-]{2,40}$/

/** The exact claim shape firestore.rules reads. Mirrors claimsFor() in scripts/syncClaims.js. */
function claimsFor(profile) {
  return {
    role: profile.role,
    teamId: profile.teamId ?? null,
    orgId: profile.orgId,
    active: profile.isActive !== false,
  }
}

export const syncClaimsOnUserCreate = onDocumentCreated('users/{uid}', async (event) => {
  const uid = event.params.uid
  const profile = event.data?.data()
  if (!profile) return

  // A permanently-invalid document must not retry forever — log and stop, rather than
  // throwing, which Cloud Functions would otherwise redeliver.
  if (!VALID_ROLES.includes(profile.role)) {
    logger.warn(`syncClaimsOnUserCreate: ${uid} has an unknown role "${profile.role}" — skipped`)
    return
  }
  if (!ORG_ID_PATTERN.test(profile.orgId ?? '')) {
    logger.warn(`syncClaimsOnUserCreate: ${uid} has an invalid orgId "${profile.orgId}" — skipped`)
    return
  }

  const auth = getAuth()
  try {
    await auth.setCustomUserClaims(uid, claimsFor(profile))
    logger.info(`syncClaimsOnUserCreate: claims set for ${uid} (${profile.role} / ${profile.orgId})`)
  } catch (error) {
    // No Auth account for this uid is possible only if something wrote users/{uid} out of
    // band without creating the account first — not a case worth retrying either.
    logger.error(`syncClaimsOnUserCreate: failed to set claims for ${uid}: ${error.message}`)
  }
})
