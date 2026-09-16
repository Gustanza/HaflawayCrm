/**
 * Seed the emulator with a realistic Haflaway organisation. TODO.md §3.
 *
 * An empty CRM tells you nothing about whether the screens work — a dashboard with three
 * rows hides every layout and performance problem you actually care about.
 *
 * REFUSES TO RUN AGAINST PRODUCTION. Emulator only, by design.
 *
 * USAGE
 *   npm run seed              (the emulators must already be running)
 *   node scripts/seed.js --leads=150
 */

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'

if (!process.env.FIRESTORE_EMULATOR_HOST?.includes('127.0.0.1')) {
  console.error('seed.js refuses to run against anything but a local emulator.')
  process.exit(1)
}

const ORG = 'haflaway'
const PROJECT_ID = process.env.VITE_FB_PROJECT_ID || 'haflawaycrm'
const PASSWORD = 'haflaway123' // emulator only

initializeApp({ projectId: PROJECT_ID })
const auth = getAuth()
const db = getFirestore()

/* -------------------------------------------------------------- deterministic randomness */
let rngState = 42
function rand() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min

/* ------------------------------------------------------------------------------- fixtures */

const TEAMS = [
  { id: 'team-dar', name: 'Dar es Salaam', region: 'Dar es Salaam' },
  { id: 'team-mwanza', name: 'Mwanza', region: 'Mwanza' },
]

const USERS = [
  { uid: 'u-admin', email: 'admin@haflaway.com', displayName: 'Asha Mwinyi', role: 'admin', teamId: 'team-dar' },
  { uid: 'u-mgr-dar', email: 'manager.dar@haflaway.com', displayName: 'Neema Shirima', role: 'manager', teamId: 'team-dar' },
  { uid: 'u-mgr-mwz', email: 'manager.mwanza@haflaway.com', displayName: 'Baraka Massawe', role: 'manager', teamId: 'team-mwanza' },
  { uid: 'u-agent-1', email: 'agent1@haflaway.com', displayName: 'Zawadi Mrema', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-2', email: 'agent2@haflaway.com', displayName: 'Frank Ndosi', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-3', email: 'agent3@haflaway.com', displayName: 'Halima Suleiman', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-4', email: 'agent4@haflaway.com', displayName: 'Emmanuel Kessy', role: 'agent', teamId: 'team-mwanza' },
  { uid: 'u-agent-5', email: 'agent5@haflaway.com', displayName: 'Grace Mollel', role: 'agent', teamId: 'team-mwanza' },
  // Deliberately deactivated, so the "no access" path is testable without editing data.
  { uid: 'u-ex-staff', email: 'exstaff@haflaway.com', displayName: 'Former Staff', role: 'agent', teamId: 'team-dar', isActive: false },
]

const FIRST_NAMES = ['Neema', 'Baraka', 'Amina', 'Joseph', 'Fatuma', 'Daniel', 'Zainab', 'Emmanuel',
  'Happiness', 'Musa', 'Upendo', 'Gerald', 'Sikitu', 'Elias', 'Mwajuma', 'Deogratias']
const EVENT_TYPES = ['harusi', 'send_off', 'kitchen_party', 'mahafali', 'kumbukumbu', 'corporate', 'other']
const SOURCES = ['facebook', 'instagram', 'whatsapp', 'committee_visit', 'referral', 'walk_in', 'other']
const CHANNELS = ['call', 'whatsapp', 'sms', 'in_person', 'other']
const CALL_OUTCOMES = ['spoke', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback_requested']
const PRODUCT_TYPES = ['committee_invite', 'contribution_reminder', 'contribution_card', 'invitation_card', 'other']
const LOST_REASONS = ['price', 'chose_competitor', 'did_it_themselves', 'event_cancelled', 'no_budget', 'no_response', 'wrong_fit', 'other']

/* ------------------------------------------------------------------------------ utilities */

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Period keys in Africa/Dar_es_Salaam (UTC+3, no DST) — must match src/domain/periods.js. */
function periodKeys(date) {
  const org = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const y = org.getUTCFullYear()
  const m = org.getUTCMonth() + 1
  const d = org.getUTCDate()

  const target = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNum + 3)
  const isoYear = target.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000))
  const quarter = Math.floor((m - 1) / 3) + 1

  return {
    dayKey: `${y}-${pad(m)}-${pad(d)}`,
    weekKey: `${isoYear}-W${pad(week)}`,
    monthKey: `${y}-${pad(m)}`,
    quarterKey: `${y}-Q${quarter}`,
  }
}

/** A valid-looking TZ mobile number, unique per index so the dedupe lock is exercised. */
function phoneFor(index) {
  const prefixes = ['71', '74', '75', '76', '78', '68']
  const prefix = prefixes[index % prefixes.length]
  return `+255${prefix}${String(1000000 + index).slice(-7)}`
}

const daysFromNow = (d) => new Date(Date.now() + d * 24 * 3600 * 1000)

/* ----------------------------------------------------------------------------------- main */

async function clear() {
  const collections = ['users', 'usersPublic', 'teams', 'orgs', 'leads', 'leadPhoneIndex']
  for (const name of collections) {
    const snap = await db.collection(name).get()
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch()
      for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref)
      await batch.commit()
    }
  }
  // Subcollections aren't reached by a top-level collection().get() — walk each lead.
  const leadsSnap = await db.collection('leads').get()
  for (const lead of leadsSnap.docs) {
    for (const sub of ['deals', 'activities']) {
      const subSnap = await lead.ref.collection(sub).get()
      const batch = db.batch()
      for (const d of subSnap.docs) batch.delete(d.ref)
      if (subSnap.size) await batch.commit()
    }
  }
  console.log('  cleared existing collections')
}

async function seedOrg() {
  // Without this, ORG is unclaimed as far as `orgs/{orgId}` is concerned, and
  // firestore.rules' self-registration path grants admin to whoever creates that document
  // first — so anyone who ever ran `/register` with the company name "Haflaway" against a
  // deployment seeded this way could claim this exact org out from under it.
  await db.doc(`orgs/${ORG}`).set({
    orgId: ORG,
    name: 'Haflaway',
    ownerUid: 'u-admin',
    createdBy: 'u-admin',
    createdAt: Timestamp.now(),
  })
}

async function seedUsers() {
  for (const u of USERS) {
    try {
      await auth.deleteUser(u.uid)
    } catch {
      /* first run — nothing to delete */
    }
    await auth.createUser({
      uid: u.uid,
      email: u.email,
      password: PASSWORD,
      displayName: u.displayName,
      disabled: u.isActive === false,
    })
    await auth.setCustomUserClaims(u.uid, {
      role: u.role,
      teamId: u.teamId,
      orgId: ORG,
      active: u.isActive !== false,
    })
    // The redacted mirror — leads/dashboard screens read a colleague's NAME from here, never
    // from `users/{uid}` (which carries targets/phone/FCM tokens agents must not see).
    await db.doc(`usersPublic/${u.uid}`).set({
      orgId: ORG,
      displayName: u.displayName,
      photoPath: null,
      isActive: u.isActive !== false,
    })

    await db.doc(`users/${u.uid}`).set({
      orgId: ORG,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      teamId: u.teamId,
      isActive: u.isActive !== false,
      locale: 'en',
      createdAt: Timestamp.now(),
      createdBy: 'seed',
      updatedAt: Timestamp.now(),
      updatedBy: 'seed',
    })
  }
  console.log(`  ${USERS.length} users (password: ${PASSWORD})`)
}

async function seedTeams() {
  for (const t of TEAMS) {
    await db.doc(`teams/${t.id}`).set({
      orgId: ORG,
      name: t.name,
      region: t.region,
      managerId: t.id === 'team-dar' ? 'u-mgr-dar' : 'u-mgr-mwz',
      memberIds: USERS.filter((u) => u.teamId === t.id).map((u) => u.uid),
      createdAt: Timestamp.now(), createdBy: 'seed',
      updatedAt: Timestamp.now(), updatedBy: 'seed',
    })
  }
  console.log(`  ${TEAMS.length} teams`)
}

/**
 * Zero, one or several product deals per lead — some open, some closed won, some closed
 * lost — because "closed for reminders, still open for the invitation" is the exact shape
 * this seed has to exercise for the screens to be worth looking at.
 */
async function seedDealsAndActivities(leadRef, owner, createdAt) {
  const productCount = randInt(0, 3)
  const products = [...PRODUCT_TYPES].sort(() => rand() - 0.5).slice(0, productCount)
  let closedWon = 0

  for (const productType of products) {
    const roll = rand()
    const status = roll < 0.4 ? 'closed_won' : roll < 0.6 ? 'closed_lost' : 'open'
    const dealRef = db.collection(`leads/${leadRef.id}/deals`).doc()
    const closedAt = status !== 'open' ? daysFromNow(-randInt(0, 30)) : null
    const closedKeys = closedAt ? periodKeys(closedAt) : {}

    await dealRef.set({
      orgId: ORG,
      productType,
      status,
      closedAt: closedAt ? Timestamp.fromDate(closedAt) : null,
      closedBy: closedAt ? owner.uid : null,
      lostReason: status === 'closed_lost' ? pick(LOST_REASONS) : null,
      closedDayKey: closedKeys.dayKey ?? null,
      closedWeekKey: closedKeys.weekKey ?? null,
      closedMonthKey: closedKeys.monthKey ?? null,
      closedQuarterKey: closedKeys.quarterKey ?? null,
      createdAt: Timestamp.fromDate(createdAt),
      createdBy: owner.uid,
      updatedAt: Timestamp.fromDate(closedAt ?? createdAt),
      updatedBy: owner.uid,
    })
    if (status === 'closed_won') closedWon += 1
  }

  // A short timeline so Lead Detail has something real to render, and so the dashboard's
  // "contacts made" count isn't just zero everywhere.
  const activityCount = randInt(1, 5)
  let lastActivity = null
  for (let a = 0; a < activityCount; a += 1) {
    const at = daysFromNow(-randInt(0, 40))
    const keys = periodKeys(at)
    const channel = pick(CHANNELS)
    const outcome = pick(CALL_OUTCOMES)
    const activityRef = db.collection(`leads/${leadRef.id}/activities`).doc()
    const summary = outcome === 'spoke' ? 'Discussed timing and next steps.' : ''

    await activityRef.set({
      orgId: ORG,
      channel,
      outcome,
      summary,
      dealId: null,
      byUserId: owner.uid,
      byUserName: owner.displayName,
      at: Timestamp.fromDate(at),
      nextFollowUpAt: null,
      ...keys,
      isVoided: false,
      voidedBy: null,
      voidReason: null,
      voidedAt: null,
    })

    if (!lastActivity || at > lastActivity.at) {
      lastActivity = { at, channel, outcome, summary, id: activityRef.id }
    }
  }

  return { closedWon, lastActivity }
}

async function seedLeads(total) {
  const agents = USERS.filter((u) => u.role === 'agent' && u.isActive !== false)
  let hotCount = 0

  for (let i = 0; i < total; i += 1) {
    const owner = agents[i % agents.length]
    const createdAt = daysFromNow(-randInt(0, 90))
    const keys = periodKeys(createdAt)
    const phone = phoneFor(i)
    const eventType = pick(EVENT_TYPES)
    const hasEvent = rand() > 0.15
    const eventDate = hasEvent ? daysFromNow(randInt(-10, 240)) : null

    const isHot = rand() > 0.85
    if (isHot) hotCount += 1

    const leadRef = db.collection('leads').doc(`lead-${String(i).padStart(4, '0')}`)
    const coupleA = pick(FIRST_NAMES)
    const coupleB = pick(FIRST_NAMES)

    const { lastActivity } = await seedDealsAndActivities(leadRef, owner, createdAt)

    // Follow-up: a spread of overdue / due today / upcoming, so the Work Queue has all
    // three sections populated. ~10% have none (every deal closed, nothing pending).
    const followUpRoll = rand()
    const nextFollowUpAt =
      followUpRoll < 0.1 ? null : daysFromNow(randInt(-5, 10))

    await leadRef.set({
      orgId: ORG,
      ownerId: owner.uid,
      previousOwnerIds: [],
      teamId: owner.teamId,

      displayName: `${coupleA} & ${coupleB}`,
      primaryPhone: phone,
      primaryPhoneNormalized: phone,
      altPhones: [],
      email: null,

      source: pick(SOURCES),
      referredBy: null,

      eventType: hasEvent ? eventType : null,
      eventDate: eventDate ? Timestamp.fromDate(eventDate) : null,
      eventDateIsFirm: hasEvent ? rand() > 0.3 : false,

      nextFollowUpAt: nextFollowUpAt ? Timestamp.fromDate(nextFollowUpAt) : null,
      nextFollowUpType: nextFollowUpAt ? pick(['call', 'whatsapp']) : null,
      firstContactedAt: lastActivity ? Timestamp.fromDate(createdAt) : null,
      lastContactedAt: lastActivity && lastActivity.outcome === 'spoke'
        ? Timestamp.fromDate(lastActivity.at) : null,
      lastActivityAt: lastActivity ? Timestamp.fromDate(lastActivity.at) : null,

      lastActivitySummary: lastActivity?.summary || null,
      lastActivityChannel: lastActivity?.channel ?? null,
      lastActivityOutcome: lastActivity?.outcome ?? null,
      lastActivityId: lastActivity?.id ?? null,

      isHot,

      ...keys,

      createdAt: Timestamp.fromDate(createdAt),
      createdBy: owner.uid,
      updatedAt: Timestamp.fromDate(createdAt),
      updatedBy: owner.uid,
      deletedAt: null,
    })

    // The dedupe lock (§4). Seeding it keeps the emulator honest: a quick-add of a seeded
    // number must be refused, exactly as it would be in production.
    await db.doc(`leadPhoneIndex/${ORG}_${phone}`).set({
      orgId: ORG, leadId: leadRef.id, ownerId: owner.uid, phoneNormalized: phone,
      createdAt: Timestamp.fromDate(createdAt),
    })
  }
  console.log(`  ${total} leads with deals, timelines and phone-index entries (${hotCount} flagged hot)`)
}

async function main() {
  console.log(`Seeding emulator for project ${PROJECT_ID}…`)
  const leadCount = Number(args.leads ?? 150)

  await clear()
  await seedOrg()
  await seedUsers()
  await seedTeams()
  await seedLeads(leadCount)

  console.log('\nDone. Sign in with any of:')
  for (const u of USERS.filter((x) => x.isActive !== false)) {
    console.log(`  ${u.email.padEnd(30)} ${PASSWORD}   (${u.role})`)
  }
}

main().catch((error) => {
  console.error('seed failed:', error)
  process.exit(1)
})
