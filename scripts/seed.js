/**
 * Seed the emulator with a realistic Haflaway organisation.
 *
 * TODO.md Phase 1: "1 admin, 2 managers, 8 agents, 2 teams". This goes further and seeds
 * settings, products and a spread of leads, because an empty CRM tells you nothing about
 * whether the screens work — and a dashboard with three rows in it hides every layout and
 * performance problem you actually care about.
 *
 * REFUSES TO RUN AGAINST PRODUCTION. Emulator only, by design.
 *
 * USAGE
 *   npm run seed              (starts nothing — the emulators must already be running)
 *   node scripts/seed.js --leads=500
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

// A seed script writes fabricated leads and fake payroll figures. Running it against the
// real database would poison every CAC number in the system, so refuse outright rather
// than rely on the operator reading a warning.
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
// A fixed seed means everyone on the team sees the same data and can talk about "the
// Neema lead" without ambiguity, and a screenshot in a bug report is reproducible.
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
  { uid: 'u-finance', email: 'finance@haflaway.com', displayName: 'Juma Kileo', role: 'finance', teamId: 'team-dar' },
  { uid: 'u-mgr-dar', email: 'manager.dar@haflaway.com', displayName: 'Neema Shirima', role: 'manager', teamId: 'team-dar' },
  { uid: 'u-mgr-mwz', email: 'manager.mwanza@haflaway.com', displayName: 'Baraka Massawe', role: 'manager', teamId: 'team-mwanza' },
  { uid: 'u-agent-1', email: 'agent1@haflaway.com', displayName: 'Zawadi Mrema', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-2', email: 'agent2@haflaway.com', displayName: 'Frank Ndosi', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-3', email: 'agent3@haflaway.com', displayName: 'Halima Suleiman', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-4', email: 'agent4@haflaway.com', displayName: 'Emmanuel Kessy', role: 'agent', teamId: 'team-dar' },
  { uid: 'u-agent-5', email: 'agent5@haflaway.com', displayName: 'Grace Mollel', role: 'agent', teamId: 'team-mwanza' },
  { uid: 'u-agent-6', email: 'agent6@haflaway.com', displayName: 'Ibrahim Juma', role: 'agent', teamId: 'team-mwanza' },
  { uid: 'u-agent-7', email: 'agent7@haflaway.com', displayName: 'Rehema Chuwa', role: 'agent', teamId: 'team-mwanza' },
  { uid: 'u-agent-8', email: 'agent8@haflaway.com', displayName: 'Peter Mbwana', role: 'agent', teamId: 'team-mwanza' },
  { uid: 'u-viewer', email: 'viewer@haflaway.com', displayName: 'Board Viewer', role: 'viewer', teamId: 'team-dar' },
  // Deliberately deactivated, so the "no access" path is testable without editing data.
  { uid: 'u-ex-staff', email: 'exstaff@haflaway.com', displayName: 'Former Staff', role: 'agent', teamId: 'team-dar', isActive: false },
]

const PRODUCTS = [
  { id: 'p-ecard-basic', name: 'eCard — Basic', sku: 'ECB', basePriceMinor: 5_000_000, unitCostMinor: 800_000 },
  { id: 'p-ecard-premium', name: 'eCard — Premium', sku: 'ECP', basePriceMinor: 15_000_000, unitCostMinor: 2_500_000 },
  { id: 'p-video-invite', name: 'Video Invitation', sku: 'VID', basePriceMinor: 35_000_000, unitCostMinor: 9_000_000 },
  { id: 'p-rsvp', name: 'RSVP Page', sku: 'RSVP', basePriceMinor: 8_000_000, unitCostMinor: 1_000_000 },
  { id: 'p-reminders', name: 'Event Reminders (SMS)', sku: 'REM', basePriceMinor: 6_000_000, unitCostMinor: 2_000_000 },
]

const CAMPAIGNS = [
  { id: 'c-ig-wedding', name: 'Instagram — Wedding Season', channel: 'instagram', budgetMinor: 250_000_000 },
  { id: 'c-fb-retarget', name: 'Facebook — Retargeting', channel: 'facebook', budgetMinor: 120_000_000 },
  { id: 'c-wa-broadcast', name: 'WhatsApp Broadcast', channel: 'whatsapp', budgetMinor: 40_000_000 },
  { id: 'c-field-kamati', name: 'Committee Visits', channel: 'field', budgetMinor: 90_000_000 },
  { id: 'c-referral', name: 'Referral Programme', channel: 'referral', budgetMinor: 20_000_000 },
]

const FIRST_NAMES = ['Neema', 'Baraka', 'Amina', 'Joseph', 'Fatuma', 'Daniel', 'Zainab', 'Emmanuel',
  'Happiness', 'Musa', 'Upendo', 'Gerald', 'Sikitu', 'Elias', 'Mwajuma', 'Deogratias']
const EVENT_TYPES = ['harusi', 'send_off', 'kitchen_party', 'mahafali', 'kumbukumbu', 'corporate']
const STAGES = ['new', 'contacted', 'unreachable', 'qualified', 'quoted', 'negotiation', 'won', 'lost', 'parked', 'nurture']
const SOURCES = ['instagram', 'facebook', 'whatsapp', 'field', 'referral']
const REGIONS = ['Dar es Salaam', 'Mwanza', 'Arusha', 'Dodoma', 'Mbeya']
const LOSS_REASONS = ['price', 'chose_competitor', 'did_it_themselves', 'event_cancelled', 'no_budget', 'no_response']

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

  return {
    dayKey: `${y}-${pad(m)}-${pad(d)}`,
    weekKey: `${isoYear}-W${pad(week)}`,
    monthKey: `${y}-${pad(m)}`,
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
  const collections = ['users', 'teams', 'leads', 'tasks', 'campaigns', 'expenses',
    'products', 'settings', 'customers', 'projects', 'leadPhoneIndex', 'usersPublic',
    'rollups', 'rollupsPublic', 'costAllocationPolicy']
  for (const name of collections) {
    const snap = await db.collection(name).get()
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch()
      for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref)
      await batch.commit()
    }
  }
  console.log('  cleared existing collections')
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
    // The redacted mirror. firestore.rules defines usersPublic but nothing populated it,
    // so every screen that needed a colleague's NAME had to fall back to printing a raw
    // uid — see the per-staff CAC table. Display name and photo only: the full user doc
    // carries targets, commission rate, phone and FCM tokens (§7.1, B14).
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
      locale: 'sw',
      targets: { monthlyLeads: 40, monthlyRevenueMinor: 300_000_000 },
      capacity: { maxOpenLeads: 60 },
      createdAt: Timestamp.now(),
      createdBy: 'seed',
      updatedAt: Timestamp.now(),
      updatedBy: 'seed',
    })
  }
  console.log(`  ${USERS.length} users (password: ${PASSWORD})`)
}

async function seedReference() {
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

  for (const p of PRODUCTS) {
    await db.doc(`products/${p.id}`).set({
      orgId: ORG, ...p, category: 'invitation', isActive: true,
      createdAt: Timestamp.now(), createdBy: 'seed',
      updatedAt: Timestamp.now(), updatedBy: 'seed',
    })
  }

  for (const c of CAMPAIGNS) {
    await db.doc(`campaigns/${c.id}`).set({
      orgId: ORG, ...c, status: 'active',
      startDate: Timestamp.fromDate(daysFromNow(-90)),
      spendToDateMinor: Math.round(c.budgetMinor * 0.6),
      ownerId: 'u-mgr-dar',
      createdAt: Timestamp.now(), createdBy: 'seed',
      updatedAt: Timestamp.now(), updatedBy: 'seed',
    })
    // Daily spend entries — the append-only ledger the CAC maths reads (§8.4).
    for (let d = 60; d > 0; d -= 1) {
      const date = daysFromNow(-d)
      await db.collection(`campaigns/${c.id}/spend`).add({
        ...periodKeys(date),
        amountMinor: randInt(500_000, 4_000_000),
        currency: 'TZS',
        impressions: randInt(2000, 40000),
        clicks: randInt(20, 600),
        source: 'manual',
        enteredBy: 'u-finance',
        createdAt: Timestamp.fromDate(date),
      })
    }
    // Mirror agents may read: name and channel only, never the budget (§7.2).
    await db.doc(`campaignsPublic/${c.id}`).set({
      orgId: ORG, name: c.name, channel: c.channel, status: 'active',
    })
  }
  console.log(`  ${TEAMS.length} teams, ${PRODUCTS.length} products, ${CAMPAIGNS.length} campaigns (+60 days of spend each)`)
}

async function seedExpenses() {
  const agents = USERS.filter((u) => u.role === 'agent')
  let count = 0

  for (let monthsAgo = 2; monthsAgo >= 0; monthsAgo -= 1) {
    const date = daysFromNow(-monthsAgo * 30)
    const keys = periodKeys(date)

    for (const a of agents) {
      for (const [category, amount] of [
        ['salary', 40_000_000],
        ['airtime', randInt(1_000_000, 3_000_000)],
        ['transport', randInt(500_000, 2_500_000)],
        ['data', 1_500_000],
      ]) {
        await db.collection('expenses').add({
          orgId: ORG, category, amountMinor: amount, currency: 'TZS',
          incurredOn: Timestamp.fromDate(date), dayKey: keys.dayKey, monthKey: keys.monthKey,
          allocation: { type: 'staff', staffId: a.uid },
          isRecurring: category === 'salary',
          description: `${category} — ${a.displayName}`,
          enteredBy: 'u-finance', createdAt: Timestamp.fromDate(date), createdBy: 'u-finance',
        })
        count += 1
      }
    }

    for (const [category, amount] of [['rent', 80_000_000], ['tools', 12_000_000]]) {
      await db.collection('expenses').add({
        orgId: ORG, category, amountMinor: amount, currency: 'TZS',
        incurredOn: Timestamp.fromDate(date), dayKey: keys.dayKey, monthKey: keys.monthKey,
        allocation: { type: 'overhead' },
        isRecurring: true, description: category,
        enteredBy: 'u-finance', createdAt: Timestamp.fromDate(date), createdBy: 'u-finance',
      })
      count += 1
    }

    // The policy this month's numbers were computed under (§9). Past months are locked.
    await db.doc(`costAllocationPolicy/${keys.monthKey}`).set({
      orgId: ORG,
      overheadMethod: 'by_revenue',
      includeSalariesInCAC: true,
      includeCommissionInCAC: false,
      attributionModel: 'first_touch',
      lockedAt: monthsAgo > 0 ? Timestamp.fromDate(date) : null,
      lockedBy: monthsAgo > 0 ? 'u-finance' : null,
    })
  }
  console.log(`  ${count} expense entries across 3 months, with cost policies`)
}

async function seedLeads(total) {
  const agents = USERS.filter((u) => u.role === 'agent')
  let taskCount = 0

  for (let i = 0; i < total; i += 1) {
    const owner = agents[i % agents.length]
    const stage = pick(STAGES)
    const createdAt = daysFromNow(-randInt(0, 90))
    const keys = periodKeys(createdAt)
    const phone = phoneFor(i)
    const eventType = pick(EVENT_TYPES)

    // A realistic spread of event dates: mostly ahead, some very close (P2 urgency),
    // and a few already past so the "parked / event passed" path has real data.
    const eventOffset = randInt(-20, 240)
    const eventDate = daysFromNow(eventOffset)

    const isClosed = ['won', 'lost'].includes(stage)
    const dealValueMinor = ['quoted', 'negotiation', 'won'].includes(stage)
      ? randInt(5, 60) * 1_000_000
      : null

    const leadId = `lead-${String(i).padStart(4, '0')}`
    const coupleA = pick(FIRST_NAMES)
    const coupleB = pick(FIRST_NAMES)

    await db.doc(`leads/${leadId}`).set({
      orgId: ORG,
      ownerId: owner.uid,
      teamId: owner.teamId,
      previousOwnerIds: [],
      displayName: `${coupleA} & ${coupleB}`,
      primaryPhone: phone,
      primaryPhoneNormalized: phone,
      altPhones: [],
      eventType,
      eventDate: Timestamp.fromDate(eventDate),
      eventDateIsFirm: rand() > 0.3,
      guestCountEstimate: randInt(50, 800),
      region: pick(REGIONS),
      daysToEvent: eventOffset,
      stage,
      stageEnteredAt: Timestamp.fromDate(createdAt),
      leadStatus:
        stage === 'won' ? 'closed_won'
        : stage === 'lost' ? 'closed_lost'
        : stage === 'parked' ? 'parked'
        : 'open',
      qualification: {
        budgetBand: pick(['unknown', '<50k', '50-150k', '150-500k', '500k+']),
        decisionMakerContactId: null,
        committeeMeetsOn: null,
        interestedProductIds: [pick(PRODUCTS).id],
      },
      qualificationScore: randInt(0, 100),
      urgencyScore: eventOffset <= 7 ? 100 : eventOffset <= 30 ? 70 : 10,
      priorityScore: randInt(0, 100),
      dealValueMinor,
      currency: 'TZS',
      depositPaidMinor: stage === 'won' ? Math.round(dealValueMinor * 0.5) : null,
      nextActionAt: isClosed ? null : Timestamp.fromDate(daysFromNow(randInt(-5, 10))),
      nextActionType: isClosed ? null : pick(['call', 'whatsapp', 'visit']),
      firstContactedAt: stage === 'new' ? null : Timestamp.fromDate(createdAt),
      lastContactedAt: stage === 'new' ? null : Timestamp.fromDate(daysFromNow(-randInt(0, 20))),
      contactAttempts: randInt(0, 8),
      consecutiveNoAnswer: stage === 'unreachable' ? randInt(1, 4) : 0,
      cadence: stage === 'unreachable' ? { id: 'unreachable_standard', step: randInt(0, 3) } : null,
      isStale: false,
      attribution: {
        model: 'first_touch',
        source: pick(SOURCES),
        channel: pick(SOURCES),
        campaignId: pick(CAMPAIGNS).id,
        utm: {},
        capturedByUserId: owner.uid,
        capturedAt: Timestamp.fromDate(createdAt),
      },
      marketingConsent: rand() > 0.2,
      closedAt: isClosed ? Timestamp.fromDate(daysFromNow(-randInt(0, 30))) : null,
      closedBy: isClosed ? owner.uid : null,
      lossReason: stage === 'lost' ? pick(LOSS_REASONS) : null,
      parkReason: stage === 'parked' ? 'no_response_after_cadence' : null,
      ...keys,
      tags: [],
      createdAt: Timestamp.fromDate(createdAt),
      createdBy: owner.uid,
      updatedAt: Timestamp.fromDate(createdAt),
      updatedBy: owner.uid,
      deletedAt: null,
    })

    // The dedupe lock (§6.4). Seeding it keeps the emulator honest: a quick-add of a
    // seeded number must be refused, exactly as it would be in production.
    // Key is `{orgId}_{phone}` — see phoneIndexKey() in src/services/leads.service.js.
    await db.doc(`leadPhoneIndex/${ORG}_${phone}`).set({
      orgId: ORG, leadId, ownerId: owner.uid, phoneNormalized: phone,
      createdAt: Timestamp.fromDate(createdAt),
    })

    // A short timeline so the lead detail screen has something real to render.
    for (let a = 0; a < randInt(1, 5); a += 1) {
      const at = daysFromNow(-randInt(0, 40))
      await db.collection(`leads/${leadId}/activities`).add({
        type: pick(['call', 'whatsapp', 'visit', 'note']),
        at: Timestamp.fromDate(at),
        byUserId: owner.uid,
        byUserName: owner.displayName,
        channel: pick(['call', 'whatsapp', 'in_person']),
        outcome: pick(['spoke', 'no_answer', 'busy', 'switched_off', 'callback_requested']),
        body: '',
        isVoided: false,
      })
    }

    if (!isClosed) {
      const dueAt = daysFromNow(randInt(-3, 7))
      await db.collection('tasks').add({
        orgId: ORG,
        leadId,
        leadName: `${coupleA} & ${coupleB}`,
        leadPhone: phone,
        ownerId: owner.uid,
        teamId: owner.teamId,
        title: 'Fuatilia mteja',
        type: pick(['call', 'whatsapp']),
        dueAt: Timestamp.fromDate(dueAt),
        dayKey: periodKeys(dueAt).dayKey,
        status: 'open',
        priority: randInt(1, 3),
        isAutoGenerated: true,
        createdAt: Timestamp.now(),
      })
      taskCount += 1
    }
  }
  console.log(`  ${total} leads with timelines, phone-index entries and ${taskCount} open tasks`)
}

async function seedSettings() {
  await db.doc('settings/org').set({
    orgId: ORG, name: 'Haflaway', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam',
    defaultLocale: 'sw',
  })
  await db.doc('settings/lossReasons').set({ orgId: ORG, reasons: LOSS_REASONS })

  // The first-admin latch. Seeded ALREADY CLAIMED, because the seed also creates a real
  // admin — leaving it open would mean any seeded account could re-appoint itself.
  // Deploy to a fresh project with `claimed: false` to make the Setup screen offer it.
  await db.doc('settings/bootstrap').set({
    claimed: true,
    claimedBy: 'u-admin',
    claimedAt: Timestamp.now(),
    orgId: ORG,
  })
  console.log('  settings')
}

async function main() {
  console.log(`Seeding emulator for project ${PROJECT_ID}…`)
  const leadCount = Number(args.leads ?? 150)

  await clear()
  await seedUsers()
  await seedReference()
  await seedSettings()
  await seedExpenses()
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
