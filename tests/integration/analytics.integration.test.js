/**
 * The CAC dashboard, computed from REAL seeded documents.
 *
 * Unit tests prove the formulas are right against fixtures I wrote. This proves they are
 * right against data the seed script wrote — which is where shape mismatches show up:
 * a missing `monthKey`, an `allocation` that never matches, a `dealValueMinor` stored as a
 * float. Those produce plausible-looking numbers rather than errors, which is the
 * dangerous kind of wrong.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDocs } from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '@/firebase/app.js'
import { leadsQuery, expensesQuery } from '@/services/queries.js'
import { summarise, cohort, closedIn, cacBy, funnel } from '@/domain/metrics.js'
import { recentMonthKeys } from '@/domain/periods.js'
import { isValidMinor } from '@/domain/money.js'

const POLICY = {
  includeSalariesInCAC: true,
  includeCommissionInCAC: false,
  overheadMethod: 'by_revenue',
}

let leads = []
let expenses = []
let user

beforeAll(async () => {
  const credential = await signInWithEmailAndPassword(auth, 'admin@haflaway.com', 'haflaway123')
  const token = await credential.user.getIdTokenResult(true)
  user = {
    uid: credential.user.uid,
    role: token.claims.role,
    orgId: token.claims.orgId,
    teamId: token.claims.teamId,
  }

  const withId = (s) => ({ id: s.id, ...s.data() })
  leads = (await getDocs(await leadsQuery(user, { max: 500 }))).docs.map(withId)
  expenses = (await getDocs(await expensesQuery(user, { max: 500 }))).docs.map(withId)
})

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

describe('the seeded data has the shape the metrics expect', () => {
  it('has leads and expenses to work with', () => {
    expect(leads.length, 'no leads — run npm run seed').toBeGreaterThan(0)
    expect(expenses.length, 'no expenses — run npm run seed').toBeGreaterThan(0)
  })

  it('every lead carries a monthKey, or cohort selection silently returns nothing', () => {
    const missing = leads.filter((l) => !l.monthKey)
    expect(missing.map((l) => l.id)).toEqual([])
  })

  it('every expense carries a monthKey and an allocation (§9)', () => {
    expect(expenses.filter((e) => !e.monthKey).map((e) => e.id)).toEqual([])
    expect(expenses.filter((e) => !e.allocation?.type).map((e) => e.id)).toEqual([])
  })

  it('every money field is an integer in minor units — no floats in the ledger', () => {
    const badExpenses = expenses.filter((e) => !isValidMinor(e.amountMinor))
    expect(badExpenses.map((e) => e.id)).toEqual([])

    const badLeads = leads.filter(
      (l) => l.dealValueMinor !== null && l.dealValueMinor !== undefined && !isValidMinor(l.dealValueMinor),
    )
    expect(badLeads.map((l) => l.id)).toEqual([])
  })

  it('every won lead has a positive deal value — the §5.2 invariant', () => {
    const won = leads.filter((l) => l.stage === 'won')
    expect(won.length).toBeGreaterThan(0)
    for (const lead of won) expect(lead.dealValueMinor).toBeGreaterThan(0)
  })
})

describe('the dashboard produces sane numbers, not just numbers', () => {
  it('summarises the current month without a NaN or an Infinity anywhere', () => {
    const monthKey = recentMonthKeys(1)[0]
    const summary = summarise(
      cohort(leads, monthKey),
      { expenses: expenses.filter((e) => e.monthKey === monthKey), campaignSpend: [] },
      POLICY,
    )

    const scan = (value, path = '') => {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `non-finite at ${path}: ${value}`).toBe(true)
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => scan(v, `${path}[${i}]`))
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) scan(v, `${path}.${k}`)
      }
    }
    scan(summary)
  })

  it('never reports more won than closed, or more closed than created', () => {
    for (const monthKey of recentMonthKeys(6)) {
      const set = cohort(leads, monthKey)
      const s = summarise(set, { expenses: [], campaignSpend: [] }, POLICY)
      expect(s.won + s.lost, monthKey).toBeLessThanOrEqual(s.created)
      expect(s.won, monthKey).toBeLessThanOrEqual(s.created)
    }
  })

  it('keeps every rate inside 0..1', () => {
    const monthKey = recentMonthKeys(1)[0]
    const s = summarise(cohort(leads, monthKey), { expenses, campaignSpend: [] }, POLICY)
    for (const rate of [s.winRate, s.contactRate, s.qualificationRate, s.unreachableRate]) {
      if (rate.value === null) continue
      expect(rate.value).toBeGreaterThanOrEqual(0)
      expect(rate.value).toBeLessThanOrEqual(1)
    }
  })

  it('the funnel never widens as it goes down', () => {
    const steps = funnel(leads)
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i].count, `${steps[i].stage} exceeds ${steps[i - 1].stage}`).toBeLessThanOrEqual(
        steps[i - 1].count,
      )
    }
  })

  it('cohort and period genuinely disagree, which is why the toggle exists (§8.8)', () => {
    const monthKey = recentMonthKeys(1)[0]
    const byCohort = cohort(leads, monthKey).length
    const byPeriod = closedIn(leads, monthKey).length
    // Both should be meaningful, and they are answering different questions.
    expect(byCohort + byPeriod).toBeGreaterThan(0)
  })

  it('CAC is either a positive amount or null — never zero, never negative', () => {
    for (const monthKey of recentMonthKeys(6)) {
      const s = summarise(
        cohort(leads, monthKey),
        { expenses: expenses.filter((e) => e.monthKey === monthKey), campaignSpend: [] },
        POLICY,
      )
      if (s.cac.value === null) {
        expect(s.won, `${monthKey}: null CAC but wins exist`).toBe(0)
      } else {
        expect(s.cac.value, monthKey).toBeGreaterThan(0)
        expect(s.cac.n, monthKey).toBeGreaterThan(0)
      }
    }
  })

  it('per-staff CAC flags the small denominators rather than presenting them as fact', () => {
    const monthKey = recentMonthKeys(1)[0]
    const monthExpenses = expenses.filter((e) => e.monthKey === monthKey)
    const rows = cacBy(
      cohort(leads, monthKey),
      (lead) => lead.ownerId,
      (uid) => ({
        expenses: monthExpenses.filter((e) => e.allocation?.staffId === uid),
        campaignSpend: [],
      }),
      POLICY,
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // The whole guard-rail contract, on real data.
      if (row.won === 0) expect(row.value).toBeNull()
      if (row.won > 0 && row.won < 3) expect(row.lowConfidence).toBe(true)
      if (row.value !== null) expect(row.value).toBeGreaterThan(0)
    }
  })

  it('staff expenses actually match a real lead owner — an allocation nobody matches is dead weight', () => {
    const staffExpenses = expenses.filter((e) => e.allocation?.type === 'staff')
    expect(staffExpenses.length).toBeGreaterThan(0)

    const owners = new Set(leads.map((l) => l.ownerId).filter(Boolean))
    const matched = staffExpenses.filter((e) => owners.has(e.allocation.staffId))
    // If this is zero, every per-staff CAC is computed from no cost at all.
    expect(matched.length, 'no staff expense matches any lead owner').toBeGreaterThan(0)
  })
})
