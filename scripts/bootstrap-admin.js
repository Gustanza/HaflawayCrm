/**
 * Mint an admin directly from the command line, bypassing the app entirely.
 *
 * ── WHY THIS STILL EXISTS ───────────────────────────────────────────────────
 * Self-registration (RegisterView.vue → registerOrganization()) is now the normal way
 * someone becomes admin of their own new organisation — see /register. This script covers
 * what that flow does not: appointing an admin into an ALREADY-EXISTING org without going
 * through the browser (support, migrations, recovering a locked-out org), or setting one up
 * on a fresh deploy with no UI involved at all.
 *
 * It does the three things that must all happen, or the account half-works:
 *   1. creates the Firebase Auth user            → they can authenticate
 *   2. sets the custom claims                    → firestore.rules lets them read (§7.1)
 *   3. writes users/{uid} and usersPublic/{uid}  → the UI can render their name
 *
 * Miss step 2 and they sign in and land on "Your account is not set up yet". Miss step 3
 * and the app works but shows a raw uid everywhere their name should be.
 *
 * ── PASSWORDS ─────────────────────────────────────────────────────────────────
 * By default NO password is set and none is printed. The script generates a password-reset
 * link instead, which you send to the person; they choose their own. A password typed on a
 * command line ends up in shell history, in the process list, and in whatever terminal
 * scrollback gets screenshotted into a group chat.
 *
 * `--password` exists for emulator work and refuses to run against production.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────
 *   # against the local emulator
 *   node scripts/bootstrap-admin.js --emulator --email=you@haflaway.com --password=test1234
 *
 *   # against PRODUCTION — requires a service-account key and an explicit --prod
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccountKey.json
 *   node scripts/bootstrap-admin.js --prod --email=you@haflaway.com --name="Asha Mwinyi"
 *
 * Idempotent: run it again on an existing account and it re-grants the role rather than
 * failing. Safe to re-run if you are unsure whether it completed.
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const VALID_ROLES = ['admin', 'manager', 'finance', 'agent', 'viewer']

/** Must match scripts/syncClaims.js — orgId is the prefix of the leadPhoneIndex key. */
const ORG_ID_PATTERN = /^[a-z0-9-]{2,40}$/

const PROJECT_ID = process.env.VITE_FB_PROJECT_ID || 'haflawaycrm'
const DEFAULT_ORG = process.env.HAFLAWAY_ORG_ID || 'haflaway'

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

/* ------------------------------------------------------------------ validate */

const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : null
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail('Pass a real address: --email=you@haflaway.com')
}

const role = typeof args.role === 'string' ? args.role : 'admin'
if (!VALID_ROLES.includes(role)) fail(`--role must be one of: ${VALID_ROLES.join(', ')}`)

const orgId = typeof args.org === 'string' ? args.org : DEFAULT_ORG
if (!ORG_ID_PATTERN.test(orgId)) {
  fail(`--org "${orgId}" is invalid: lowercase letters, digits and hyphens only. No underscores.`)
}

const displayName = typeof args.name === 'string' ? args.name : email.split('@')[0]
const teamId = typeof args.team === 'string' ? args.team : null

/* ------------------------------------------------------ target: emulator or production */

if (args.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
}

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

// Writing an administrator into a live database is not something to do by accident, and
// `--emulator` being absent is too quiet a signal on its own.
if (!usingEmulator && !args.prod) {
  fail(
    'Refusing to touch production without --prod.\n' +
      '  For local work:  node scripts/bootstrap-admin.js --emulator --email=… --password=…\n' +
      '  For production:  node scripts/bootstrap-admin.js --prod --email=…',
  )
}

if (!usingEmulator && args.password) {
  fail(
    '--password is refused against production.\n' +
      '  It would live in your shell history and the process list. Omit it: the script\n' +
      '  generates a reset link and the person chooses their own password.',
  )
}

function credential() {
  if (usingEmulator) return undefined
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

/* ---------------------------------------------------------------------- main */

async function main() {
  console.log(
    `\nBootstrapping ${role} — project ${PROJECT_ID}, ` +
      `${usingEmulator ? 'EMULATOR' : 'PRODUCTION'}\n`,
  )

  // 1. The Auth account.
  let user
  let created = false
  try {
    user = await auth.getUserByEmail(email)
    console.log(`  · account already exists (${user.uid}) — re-granting the role`)
  } catch {
    user = await auth.createUser({
      email,
      displayName,
      // A random password nobody ever sees. The reset link below is how they get in.
      password: typeof args.password === 'string' ? args.password : randomBytes(24).toString('hex'),
      emailVerified: false,
      disabled: false,
    })
    created = true
    console.log(`  + created Auth account (${user.uid})`)
  }

  // 2. The claims. THIS is what firestore.rules reads — without it every rule denies.
  const claims = { role, teamId, orgId, active: true }
  await auth.setCustomUserClaims(user.uid, claims)
  console.log(`  + claims set: ${JSON.stringify(claims)}`)

  const now = new Date()

  // 2.5. The org's registration lock. Without this, `orgId` stays unclaimed as far as
  // `orgs/{orgId}` is concerned — and firestore.rules' self-registration path grants admin
  // to WHOEVER creates that document first. Skipping this step left every org provisioned
  // by this script (or by scripts/seed.js) open to being claimed out from under it by a
  // stranger who simply visits /register with a matching company name. This is the same
  // lock `registerOrganization()` creates transactionally in the browser; here it is a
  // trusted, non-racing write, so a plain existence check is sufficient.
  const orgRef = db.doc(`orgs/${orgId}`)
  const orgSnap = await orgRef.get()
  if (!orgSnap.exists) {
    await orgRef.set({
      orgId,
      name: typeof args['company-name'] === 'string' ? args['company-name'] : orgId,
      ownerUid: user.uid,
      createdBy: user.uid,
      createdAt: now,
    })
    console.log(`  + orgs/${orgId} created — closes the self-registration hijack gap`)
  } else {
    console.log(`  · orgs/${orgId} already registered — no hijack risk for this org`)
  }

  // 3. The profile, and the redacted mirror the UI reads names from.
  await db.doc(`users/${user.uid}`).set(
    {
      orgId,
      email,
      displayName,
      role,
      teamId,
      isActive: true,
      locale: 'sw',
      createdAt: now,
      createdBy: 'bootstrap-admin',
      updatedAt: now,
      updatedBy: 'bootstrap-admin',
    },
    { merge: true },
  )
  await db.doc(`usersPublic/${user.uid}`).set(
    { orgId, displayName, photoPath: null, isActive: true },
    { merge: true },
  )
  console.log('  + users/{uid} and usersPublic/{uid} written')

  // 4. How they actually get in.
  if (typeof args.password === 'string') {
    console.log(`\n  Sign in with: ${email} / ${args.password}`)
  } else {
    try {
      const link = await auth.generatePasswordResetLink(email)
      console.log('\n  Send this link so they can set their own password:\n')
      console.log(`  ${link}\n`)
      console.log('  It expires — generate a fresh one by re-running this command.')
    } catch (error) {
      // Not fatal: the account and its claims are already correct.
      console.warn(`\n  ! Could not generate a reset link: ${error.message}`)
      console.warn('    Use "Forgot your password?" on the sign-in screen instead.')
    }
  }

  if (created && !usingEmulator) {
    console.log('\n  Verify by signing in. If you land on "Your account is not set up yet",')
    console.log('  the claims did not reach the token — sign out and back in to refresh it.')
  }

  console.log('')
}

main().catch((error) => {
  console.error(`\n  bootstrap-admin failed: ${error.message}\n`)
  process.exit(1)
})
