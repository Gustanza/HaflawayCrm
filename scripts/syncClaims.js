/**
 * Sync Firebase Auth custom claims from the users/{uid} documents.
 *
 * WHY THIS EXISTS (TODO.md §7.1): firestore.rules authorises from CUSTOM CLAIMS, never
 * from a document read — a rule that fetched users/{uid} would bill a read on every single
 * operation for 50 staff. The claim is therefore the AUTHORITY, and the document is the
 * richer profile the UI renders. This script is what keeps them in step, and it is the only
 * sanctioned way to grant a role.
 *
 * It also enforces the deactivation path: setting isActive:false both clears the `active`
 * claim AND disables the Auth account, so a departing staff member loses access at once
 * rather than whenever their ID token happens to expire.
 *
 * USAGE
 *   node scripts/syncClaims.js --emulator                 sync every user (emulator)
 *   node scripts/syncClaims.js --uid=abc123               sync one user
 *   node scripts/syncClaims.js --email=a@haflaway.com --role=manager --team=team-a
 *   node scripts/syncClaims.js --dry-run                  show what would change
 *
 * Against PRODUCTION, set GOOGLE_APPLICATION_CREDENTIALS to a service-account key first.
 * Never commit that key — .gitignore already excludes serviceAccountKey.json.
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const VALID_ROLES = ['admin', 'manager', 'finance', 'agent', 'viewer']

/**
 * `orgId` must not contain an underscore.
 *
 * It is the prefix of the `leadPhoneIndex/{orgId}_{phone}` document key, and
 * firestore.rules authorises reads with `key.split('_')[0] == myOrg()`. An orgId like
 * `haflaway_tz` splits to `haflaway`, which both leaks that org's phone claims to its
 * prefix-neighbour AND locks it out of its own. Enforcing the format here is the cheapest
 * place to make that impossible.
 */
const ORG_ID_PATTERN = /^[a-z0-9-]{2,40}$/

function assertValidOrgId(orgId) {
  if (!ORG_ID_PATTERN.test(orgId ?? '')) {
    throw new Error(
      `orgId "${orgId}" is invalid: lowercase letters, digits and hyphens only, 2-40 chars. ` +
        'Underscores are forbidden — orgId is the prefix of the leadPhoneIndex key.',
    )
  }
}
const PROJECT_ID = process.env.VITE_FB_PROJECT_ID || 'haflawaycrm'
const DEFAULT_ORG = process.env.HAFLAWAY_ORG_ID || 'haflaway'

if (args.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
}

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

function credential() {
  if (usingEmulator) return undefined // the emulator ignores credentials entirely
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'serviceAccountKey.json'
  if (existsSync(keyPath)) return cert(JSON.parse(readFileSync(keyPath, 'utf8')))
  return applicationDefault()
}

/**
 * Build the options object WITHOUT a `credential` key when there is none.
 *
 * `initializeApp({ credential: undefined })` throws "The credential property must be an
 * object which implements the Credential interface" — the key being present with an
 * undefined value is not the same as the key being absent. Against the emulator there is
 * no credential to supply, so the key must simply not be there.
 */
function appOptions() {
  const options = { projectId: PROJECT_ID }
  const cred = credential()
  if (cred) options.credential = cred
  return options
}

initializeApp(appOptions())

const auth = getAuth()
const db = getFirestore()

const dryRun = Boolean(args['dry-run'])

/** The exact claim set firestore.rules reads. Keep this in step with §7.2. */
function claimsFor(profile) {
  const orgId = profile.orgId ?? DEFAULT_ORG
  assertValidOrgId(orgId)
  return {
    role: profile.role,
    teamId: profile.teamId ?? null,
    orgId,
    active: profile.isActive !== false,
  }
}

function claimsEqual(a = {}, b = {}) {
  return ['role', 'teamId', 'orgId', 'active'].every((k) => (a[k] ?? null) === (b[k] ?? null))
}

async function syncOne(uid, profile) {
  if (!VALID_ROLES.includes(profile.role)) {
    console.warn(`  ! ${uid}: role "${profile.role}" is not one of ${VALID_ROLES.join(', ')} — skipped`)
    return 'skipped'
  }

  const next = claimsFor(profile)
  let userRecord
  try {
    userRecord = await auth.getUser(uid)
  } catch {
    console.warn(`  ! ${uid}: no Auth account for this document — skipped`)
    return 'skipped'
  }

  const current = userRecord.customClaims ?? {}
  const shouldBeDisabled = next.active === false

  if (claimsEqual(current, next) && userRecord.disabled === shouldBeDisabled) {
    return 'unchanged'
  }

  const label = `${profile.displayName ?? userRecord.email ?? uid} → ${next.role}${
    next.active ? '' : ' (DEACTIVATED)'
  }`

  if (dryRun) {
    console.log(`  ~ would update ${label}`)
    return 'would-change'
  }

  await auth.setCustomUserClaims(uid, next)

  // Clearing the claim is not enough on its own: the user's existing ID token stays valid
  // until it expires (up to an hour). Disabling the account and revoking refresh tokens
  // ends the session now — which is what "deactivate" has to mean.
  if (userRecord.disabled !== shouldBeDisabled) {
    await auth.updateUser(uid, { disabled: shouldBeDisabled })
  }
  if (shouldBeDisabled) {
    await auth.revokeRefreshTokens(uid)
  }

  console.log(`  + ${label}`)
  return 'updated'
}

async function main() {
  console.log(
    `Syncing claims — project ${PROJECT_ID}, ${usingEmulator ? 'EMULATOR' : 'PRODUCTION'}${
      dryRun ? ', DRY RUN' : ''
    }`,
  )

  if (!usingEmulator && !dryRun) {
    console.log('  (writing to PRODUCTION auth — Ctrl+C now if that is not what you meant)')
  }

  // Grant a role directly from the command line, for bootstrapping the first admin.
  if (args.email && args.role) {
    if (!VALID_ROLES.includes(args.role)) {
      throw new Error(`--role must be one of: ${VALID_ROLES.join(', ')}`)
    }
    assertValidOrgId(args.org ?? DEFAULT_ORG)
    const user = await auth.getUserByEmail(args.email)
    const profile = {
      role: args.role,
      teamId: args.team ?? null,
      orgId: args.org ?? DEFAULT_ORG,
      isActive: true,
      displayName: user.displayName ?? args.email,
    }
    await db.doc(`users/${user.uid}`).set(
      {
        ...profile,
        email: args.email,
        updatedAt: new Date(),
        updatedBy: 'syncClaims-script',
      },
      { merge: true },
    )
    await syncOne(user.uid, profile)
    console.log('Done.')
    return
  }

  const snapshot = args.uid
    ? [await db.doc(`users/${args.uid}`).get()]
    : (await db.collection('users').get()).docs

  const tally = { updated: 0, unchanged: 0, skipped: 0, 'would-change': 0 }

  for (const doc of snapshot) {
    if (!doc.exists) {
      console.warn(`  ! ${doc.id}: no such user document`)
      continue
    }
    tally[await syncOne(doc.id, doc.data())] += 1
  }

  console.log(
    `Done. updated=${tally.updated} unchanged=${tally.unchanged} skipped=${tally.skipped}` +
      (dryRun ? ` wouldChange=${tally['would-change']}` : ''),
  )
}

main().catch((error) => {
  console.error('syncClaims failed:', error.message)
  process.exit(1)
})
