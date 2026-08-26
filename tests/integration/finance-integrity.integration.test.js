/**
 * Finance/analytics correctness against REAL seeded documents — the ledger, campaign spend,
 * and the role gates around them.
 *
 * `analytics.integration.test.js` already proves the metric FORMULAS are sane on real data.
 * This file targets two things that formula-level testing cannot see:
 *
 *   1. Whether the app's own query-builder code (`src/services/queries.js`), not just the
 *      Firestore rules, actually refuses to build a cost query for a role that must not see
 *      money — the exact function every finance/analytics view calls.
 *   2. Whether the numbers CampaignsView.vue and DashboardView.vue show are actually DERIVED
 *      from the real spend ledger (`campaigns/{id}/spend`), or from a field/variable that has
 *      quietly stopped being the same thing. Read-only: this file writes nothing, so it
 *      cannot corrupt the shared seed data other suites (and other reviewers) rely on.
 *
 * Requires emulators + seed. Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { collection, getDocs } from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, getDb } from '@/firebase/app.js'
import {
  leadsQuery, expensesQuery, campaignsQuery, campaignOptionsQuery, fetchCampaignSpend,
} from '@/services/queries.js'
import { summarise, cohort } from '@/domain/metrics.js'
import { recentMonthKeys } from '@/domain/periods.js'

const withId = (s) => ({ id: s.id, ...s.data() })

async function signInAs(email) {
  const credential = await signInWithEmailAndPassword(auth, email, 'haflaway123')
  const token = await credential.user.getIdTokenResult(true)
  return {
    uid: credential.user.uid,
    role: token.claims.role,
    orgId: token.claims.orgId,
    teamId: token.claims.teamId,
  }
}

afterAll(async () => {
  await signOut(auth).catch(() => {})
})

describe('an agent is denied cost data by the query-builder itself, not only by the rules', () => {
  it('expensesQuery() throws before any request reaches Firestore', async () => {
    const user = await signInAs('agent1@haflaway.com')
    // A throw here is synchronous JS, not a rejected Firestore call — proving the view never
    // even attempts the read. If this ever resolves instead of throwing, an agent's
    // `useCollection` would go on to call getDocs() and only the RULES would be standing
    // between an agent and a live snapshot of payroll.
    await expect(expensesQuery(user, { max: 10 })).rejects.toThrow(/may not read cost data/i)
  })

  it('campaignsQuery() throws the same way', async () => {
    const user = await signInAs('agent1@haflaway.com')
    await expect(campaignsQuery(user, { max: 10 })).rejects.toThrow(/may not read cost data/i)
  })

  it('a viewer is refused too — viewCosts is false for viewer (§7.1)', async () => {
    const user = await signInAs('viewer@haflaway.com')
    await expect(expensesQuery(user, { max: 10 })).rejects.toThrow(/may not read cost data/i)
    await expect(campaignsQuery(user, { max: 10 })).rejects.toThrow(/may not read cost data/i)
  })

  it('the redacted campaignsPublic mirror an agent DOES get carries no cost field to leak', async () => {
    const user = await signInAs('agent1@haflaway.com')
    const snap = await getDocs(await campaignOptionsQuery(user))
    expect(snap.size).toBeGreaterThan(0)
    for (const doc of snap.docs.map(withId)) {
      expect(doc, `${doc.id} leaks a cost field through campaignsPublic`).not.toHaveProperty('budgetMinor')
      expect(doc).not.toHaveProperty('spendToDateMinor')
    }
  })

  it('finance and manager both get through the same query-builder gate', async () => {
    const finance = await signInAs('finance@haflaway.com')
    await expect(expensesQuery(finance, { max: 10 })).resolves.toBeTruthy()
    const manager = await signInAs('manager.dar@haflaway.com')
    await expect(campaignsQuery(manager, { max: 10 })).resolves.toBeTruthy()
  })
})

describe('CampaignsView.vue money is only as correct as its inputs', () => {
  let finance
  let campaigns

  beforeAll(async () => {
    finance = await signInAs('finance@haflaway.com')
    campaigns = (await getDocs(await campaignsQuery(finance, { max: 100 }))).docs.map(withId)
  })

  it('has campaigns to check (seed not run?)', () => {
    expect(campaigns.length).toBeGreaterThan(0)
  })

  /**
   * `campaign.spendToDateMinor` used to look like a maintained running total but nothing in
   * this codebase ever wrote it from real spend entries — on the seeded data it disagreed
   * with the real ledger by up to ~10x. Fixed by deleting the field from seed.js entirely and
   * having CampaignsView.vue/DashboardView.vue compute spend from fetchCampaignSpend()
   * (queries.js), which reads `campaigns/{id}/spend` directly. This is the regression test
   * for that function: its output must sum to exactly the real ledger, per campaign.
   */
  it('fetchCampaignSpend() sums to exactly the real spend ledger, per campaign', async () => {
    const db = await getDb()
    const spend = await fetchCampaignSpend(finance, campaigns.map((c) => c.id))
    const summedByFn = new Map()
    for (const entry of spend) {
      summedByFn.set(entry.campaignId, (summedByFn.get(entry.campaignId) ?? 0) + (entry.amountMinor ?? 0))
    }

    for (const c of campaigns) {
      const spendSnap = await getDocs(collection(db, `campaigns/${c.id}/spend`))
      const realSum = spendSnap.docs.reduce((t, d) => t + (d.data().amountMinor ?? 0), 0)
      expect(summedByFn.get(c.id) ?? 0, `campaign ${c.id}`).toBe(realSum)
    }

    // The field itself is gone from freshly-seeded data — confirms the misleading source
    // was removed, not just bypassed.
    expect(campaigns.every((c) => c.spendToDateMinor === undefined)).toBe(true)
  })
})

describe('DashboardView.vue money is only as correct as its inputs', () => {
  let leads
  let expenses
  let campaigns

  const POLICY = { includeSalariesInCAC: true, includeCommissionInCAC: false, overheadMethod: 'by_revenue' }

  beforeAll(async () => {
    const user = await signInAs('finance@haflaway.com')
    leads = (await getDocs(await leadsQuery(user, { max: 500 }))).docs.map(withId)
    expenses = (await getDocs(await expensesQuery(user, { max: 500 }))).docs.map(withId)
    campaigns = (await getDocs(await campaignsQuery(user, { max: 100 }))).docs.map(withId)
  })

  /**
   * DashboardView.vue's `summary` and `trend` computeds used to call
   * `summarise(monthLeads, { expenses: monthExpenses, campaignSpend: [] }, policy)` with
   * `campaignSpend` hardcoded to `[]` everywhere in the file — the view never queried
   * `campaigns` or `campaigns/{id}/spend` at all, so the headline CAC permanently excluded
   * every shilling of ad spend (the seeded `expenses` collection has zero `ad_spend`-category
   * documents; every ad dollar lives in the campaign spend ledger by design). Fixed by having
   * the view load campaigns + fetchCampaignSpend() and filter by month, exactly like
   * `monthExpenses` already did. This test proves the fixed wiring — real ledger spend fed
   * into `campaignSpend` — actually changes `adSpendMinor`/`costMinor`, using the same
   * fetchCampaignSpend() function the view now calls, not a hand-summed shadow query.
   */
  it('summarise() actually includes campaign ad spend when fed real ledger entries', async () => {
    const user = await signInAs('finance@haflaway.com')

    // Find a real month with real ad spend on the books, rather than assume "this month".
    const allSpend = await fetchCampaignSpend(user, campaigns.map((c) => c.id))
    let monthKey = null
    let realAdSpend = 0
    for (const key of recentMonthKeys(6)) {
      const total = allSpend
        .filter((s) => s.monthKey === key)
        .reduce((t, s) => t + (s.amountMinor ?? 0), 0)
      if (total > 0) {
        monthKey = key
        realAdSpend = total
        break
      }
    }
    expect(monthKey, 'no month with real campaign spend found — cannot exercise the fix').not.toBeNull()

    const monthExpenses = expenses.filter((e) => e.monthKey === monthKey)
    const monthLeads = cohort(leads, monthKey)
    const monthSpend = allSpend.filter((s) => s.monthKey === monthKey)

    // The OLD behaviour, for contrast — still a legitimate thing to assert about: an empty
    // campaignSpend array must produce zero ad spend, so the formula itself isn't the bug.
    const withoutCampaignSpend = summarise(monthLeads, { expenses: monthExpenses, campaignSpend: [] }, POLICY)
    expect(withoutCampaignSpend.adSpendMinor).toBe(0)

    // What the view now actually computes, using the real fetchCampaignSpend() output.
    const asFixedViewComputesIt = summarise(
      monthLeads,
      { expenses: monthExpenses, campaignSpend: monthSpend },
      POLICY,
    )
    expect(asFixedViewComputesIt.adSpendMinor).toBe(realAdSpend)
    expect(asFixedViewComputesIt.costMinor).toBe(withoutCampaignSpend.costMinor + realAdSpend)
  })
})
