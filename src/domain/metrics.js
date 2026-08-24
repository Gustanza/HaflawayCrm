/**
 * The metric definitions — TODO.md §8. This module IS the contract.
 *
 * Pure functions over arrays of documents. No Firebase, no formatting, no rounding for
 * display. Every figure the product shows comes from here, so that two screens can never
 * quietly disagree about what "win rate" means.
 *
 * THREE RULES, all of them learned the hard way and all enforced below:
 *
 *   1. A zero denominator returns null, never 0 and never Infinity. §8.5: the UI renders
 *      null as an em dash. A CAC of "0" reads as free; a CAC of "∞" reads as broken.
 *   2. Every ratio carries its denominator. `{ value, n }`. A CAC computed from two won
 *      deals is noise, and the caller must be able to say so — see `LOW_CONFIDENCE_N`.
 *   3. Cohort ≠ period. Ask which question you are answering before you sum anything (§8.8).
 */

import { monthKey as monthKeyOf, toDate, daysBetween } from './periods.js'
import { addMinor, divideMinor } from './money.js'

/**
 * Below this many won customers, a per-staff or per-campaign CAC is noise, not signal.
 * §8.5 requires the UI to grey it and say so — it will otherwise be used in a performance
 * review as though it were a measurement.
 */
export const LOW_CONFIDENCE_N = 3

/** A measured ratio and the denominator it came from. */
function ratio(numerator, denominator) {
  if (!denominator) return { value: null, n: denominator ?? 0 }
  return { value: numerator / denominator, n: denominator }
}

/** A money-per-thing figure. Null denominator → null value, never zero. */
function perUnit(totalMinor, count) {
  if (!count) return { value: null, n: count ?? 0 }
  return { value: divideMinor(totalMinor, count), n: count }
}

const sum = (values) => addMinor(...values.filter(Number.isInteger))

/* ---------------------------------------------------------------------------
 * Predicates — one definition each, used everywhere.
 * ------------------------------------------------------------------------- */

export const isWon = (lead) => lead?.stage === 'won'
export const isLost = (lead) => lead?.stage === 'lost'
export const isClosed = (lead) => isWon(lead) || isLost(lead)
export const isOpen = (lead) => lead?.leadStatus === 'open'

/** §8.2: qualified means it REACHED qualification, not that it is sitting there now. */
const QUALIFIED_OR_BEYOND = ['qualified', 'quoted', 'negotiation', 'won']
export const reachedQualified = (lead) => QUALIFIED_OR_BEYOND.includes(lead?.stage)

/** Contact means a two-way conversation happened. A ringing phone is not contact. */
export const wasContacted = (lead) => Boolean(lead?.firstContactedAt || lead?.lastContactedAt)

/* ---------------------------------------------------------------------------
 * Period selection — §8.8, the cohort/period distinction
 * ------------------------------------------------------------------------- */

/**
 * COHORT: leads CREATED in this month. Answers "was that month's marketing money well
 * spent?" Incomplete for recent months, because those deals are still open.
 */
export function cohort(leads, monthKey) {
  return leads.filter((lead) => (lead.monthKey ?? monthKeyOf(lead.createdAt)) === monthKey)
}

/**
 * PERIOD: leads CLOSED in this month. Answers "how did we do that month?" Mixes in spend
 * from earlier months, because the deal was probably created earlier.
 */
export function closedIn(leads, monthKey) {
  return leads.filter((lead) => lead.closedAt && monthKeyOf(lead.closedAt) === monthKey)
}

export function createdIn(leads, monthKey) {
  return cohort(leads, monthKey)
}

/* ---------------------------------------------------------------------------
 * §8.1 Volume
 * ------------------------------------------------------------------------- */

export function volume(leads) {
  return {
    created: leads.length,
    contacted: leads.filter(wasContacted).length,
    qualified: leads.filter(reachedQualified).length,
    won: leads.filter(isWon).length,
    lost: leads.filter(isLost).length,
    open: leads.filter(isOpen).length,
  }
}

/** Of the leads we captured, how many did we actually manage to speak to? */
export function contactRate(leads) {
  return ratio(leads.filter(wasContacted).length, leads.length)
}

/* ---------------------------------------------------------------------------
 * §8.2 Conversion
 * ------------------------------------------------------------------------- */

/**
 * §8.2, and the comment is load-bearing: win rate divides by CLOSED deals, never by all
 * leads. Dividing by all leads makes the number fall every time someone adds a prospect,
 * which punishes the exact behaviour the product exists to encourage.
 */
export function winRate(leads) {
  const won = leads.filter(isWon).length
  const closed = leads.filter(isClosed).length
  return ratio(won, closed)
}

export function lossRate(leads) {
  const lost = leads.filter(isLost).length
  const closed = leads.filter(isClosed).length
  return ratio(lost, closed)
}

export function qualificationRate(leads) {
  return ratio(leads.filter(reachedQualified).length, leads.filter(wasContacted).length)
}

/** Where the funnel leaks. Counts leads that REACHED each stage, not that sit there. */
export function funnel(leads) {
  const reached = (stages) => leads.filter((l) => stages.includes(l.stage)).length
  const created = leads.length
  const contacted = leads.filter(wasContacted).length
  const qualified = reached(QUALIFIED_OR_BEYOND)
  const quoted = reached(['quoted', 'negotiation', 'won'])
  const won = reached(['won'])

  return [
    { stage: 'created', count: created, dropoff: null },
    { stage: 'contacted', count: contacted, dropoff: created ? 1 - contacted / created : null },
    { stage: 'qualified', count: qualified, dropoff: contacted ? 1 - qualified / contacted : null },
    { stage: 'quoted', count: quoted, dropoff: qualified ? 1 - quoted / qualified : null },
    { stage: 'won', count: won, dropoff: quoted ? 1 - won / quoted : null },
  ]
}

/* ---------------------------------------------------------------------------
 * §8.3 Money in
 * ------------------------------------------------------------------------- */

export function revenueMinor(leads) {
  return sum(leads.filter(isWon).map((l) => l.dealValueMinor))
}

export function avgDealValue(leads) {
  const won = leads.filter(isWon)
  return perUnit(revenueMinor(leads), won.length)
}

export function pipelineValueMinor(leads) {
  return sum(leads.filter(isOpen).map((l) => l.dealValueMinor))
}

/** §8.6: weighted by stage probability. Those probabilities are ESTIMATES, not measurements. */
export function weightedPipelineMinor(leads, probabilities) {
  return leads
    .filter(isOpen)
    .reduce(
      (total, lead) =>
        total + Math.round((lead.dealValueMinor ?? 0) * (probabilities[lead.stage] ?? 0)),
      0,
    )
}

/* ---------------------------------------------------------------------------
 * §8.4 Money out
 * ------------------------------------------------------------------------- */

const AD_CATEGORIES = ['ad_spend']
const STAFF_CATEGORIES = ['salary', 'commission', 'airtime', 'data', 'transport']

export function adSpendMinor(expenses, campaignSpend = []) {
  return (
    sum(expenses.filter((e) => AD_CATEGORIES.includes(e.category)).map((e) => e.amountMinor)) +
    sum(campaignSpend.map((s) => s.amountMinor))
  )
}

export function staffCostMinor(expenses) {
  return sum(expenses.filter((e) => STAFF_CATEGORIES.includes(e.category)).map((e) => e.amountMinor))
}

export function overheadMinor(expenses) {
  return sum(expenses.filter((e) => e.allocation?.type === 'overhead').map((e) => e.amountMinor))
}

/**
 * Total acquisition cost under an explicit POLICY (§9).
 *
 * The policy is not a detail — including or excluding salaries changes CAC by a factor of
 * several, and the answer is a business decision, not a technical one. It is frozen per
 * month in `costAllocationPolicy/{monthKey}` so a chart drawn in December about August
 * still reflects August's rules.
 */
export function totalCostMinor(
  { expenses = [], campaignSpend = [] },
  policy = { includeSalariesInCAC: true, includeCommissionInCAC: false, overheadMethod: 'by_revenue' },
) {
  const ads = adSpendMinor(expenses, campaignSpend)

  const staffCategories = policy.includeCommissionInCAC
    ? STAFF_CATEGORIES
    : STAFF_CATEGORIES.filter((c) => c !== 'commission')

  const staff = policy.includeSalariesInCAC
    ? sum(
        expenses
          .filter((e) => staffCategories.includes(e.category) && e.allocation?.type !== 'overhead')
          .map((e) => e.amountMinor),
      )
    : 0

  const overhead = policy.overheadMethod === 'none' ? 0 : overheadMinor(expenses)

  return { total: ads + staff + overhead, ads, staff, overhead }
}

/* ---------------------------------------------------------------------------
 * §8.5 CAC — the number this whole product exists to produce
 * ------------------------------------------------------------------------- */

/**
 * Cost per acquired customer.
 *
 * Returns `{ value, n, lowConfidence }`. `value` is null when nobody was won — that is not
 * a CAC of zero, it is the absence of one, and §8.5 requires the UI to say so.
 */
export function cac(leads, costs, policy) {
  const won = leads.filter(isWon).length
  const { total } = totalCostMinor(costs, policy)
  const result = perUnit(total, won)
  return { ...result, totalCostMinor: total, lowConfidence: won > 0 && won < LOW_CONFIDENCE_N }
}

/** Cost per lead captured. §8.6. */
export function cpl(leads, costs, policy) {
  const { ads } = totalCostMinor(costs, policy)
  return { ...perUnit(ads, leads.length), adSpendMinor: ads }
}

/** Cost per QUALIFIED lead — usually the more honest efficiency number than CPL. */
export function cpql(leads, costs, policy) {
  const { ads } = totalCostMinor(costs, policy)
  return perUnit(ads, leads.filter(reachedQualified).length)
}

/** Return on ad spend: revenue attributed to a campaign over what it cost. */
export function roas(leads, campaignSpendMinor) {
  if (!campaignSpendMinor) return { value: null, n: 0 }
  return { value: revenueMinor(leads) / campaignSpendMinor, n: leads.filter(isWon).length }
}

/**
 * CAC broken down by a dimension — per staff (§8.5 CAC_staff), per campaign, per channel.
 *
 * `costsFor(key)` supplies the costs allocated to each bucket; the caller owns that
 * allocation because §9 makes it a policy question, not a computation.
 */
export function cacBy(leads, keyOf, costsFor, policy) {
  const buckets = new Map()

  for (const lead of leads) {
    const key = keyOf(lead)
    if (key === null || key === undefined) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(lead)
  }

  return [...buckets.entries()]
    .map(([key, bucketLeads]) => {
      const costs = costsFor(key) ?? { expenses: [], campaignSpend: [] }
      const measure = cac(bucketLeads, costs, policy)
      return {
        key,
        leads: bucketLeads.length,
        won: bucketLeads.filter(isWon).length,
        revenueMinor: revenueMinor(bucketLeads),
        winRate: winRate(bucketLeads),
        ...measure,
      }
    })
    .sort((a, b) => b.leads - a.leads)
}

/* ---------------------------------------------------------------------------
 * §8.6 Efficiency and health
 * ------------------------------------------------------------------------- */

/** MEDIAN, not mean — §8.6. One nine-month wedding drags a mean cycle into fiction. */
function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function salesCycleDays(leads) {
  const spans = leads
    .filter(isWon)
    .map((lead) => daysBetween(lead.createdAt, lead.closedAt))
    .filter((d) => d !== null && d >= 0)
  return { value: median(spans), n: spans.length }
}

/** §8.6 calls first response "the top controllable lever". Median minutes to first contact. */
export function firstResponseMinutes(leads) {
  const spans = leads
    .map((lead) => {
      const created = toDate(lead.createdAt)
      const first = toDate(lead.firstContactedAt)
      if (!created || !first) return null
      const mins = (first.getTime() - created.getTime()) / 60000
      return mins >= 0 ? Math.round(mins) : null
    })
    .filter((v) => v !== null)
  return { value: median(spans), n: spans.length }
}

export function unreachableRate(leads) {
  const open = leads.filter(isOpen)
  return ratio(open.filter((l) => l.stage === 'unreachable').length, open.length)
}

/** Open leads whose next action is already in the past — the rotting pile (§10.2). */
export function staleCount(leads, now = new Date()) {
  return leads.filter((lead) => {
    if (!isOpen(lead)) return false
    const next = toDate(lead.nextActionAt)
    return next !== null && next.getTime() < now.getTime()
  }).length
}

/** Why we lose, biggest first. The input to fixing it. */
export function lossReasons(leads) {
  const counts = new Map()
  for (const lead of leads.filter(isLost)) {
    const reason = lead.lossReason || 'other'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, share: total ? count / total : null }))
    .sort((a, b) => b.count - a.count)
}

/**
 * LTV:CAC. The ≥3 benchmark is a widely-repeated rule of thumb, NOT a law and not
 * measured here — label it as a heuristic wherever it is shown (§8.6).
 */
export function ltvToCac(ltvMinor, cacMinor) {
  if (!cacMinor) return { value: null, n: 0 }
  return { value: ltvMinor / cacMinor, n: 1 }
}

/* ---------------------------------------------------------------------------
 * A whole period, in one call — what a dashboard actually asks for.
 * ------------------------------------------------------------------------- */

export function summarise(leads, costs = {}, policy) {
  const cost = totalCostMinor(costs, policy)
  return {
    ...volume(leads),
    contactRate: contactRate(leads),
    qualificationRate: qualificationRate(leads),
    winRate: winRate(leads),
    revenueMinor: revenueMinor(leads),
    avgDealValue: avgDealValue(leads),
    pipelineValueMinor: pipelineValueMinor(leads),
    costMinor: cost.total,
    adSpendMinor: cost.ads,
    staffCostMinor: cost.staff,
    overheadMinor: cost.overhead,
    cac: cac(leads, costs, policy),
    cpl: cpl(leads, costs, policy),
    cpql: cpql(leads, costs, policy),
    salesCycleDays: salesCycleDays(leads),
    firstResponseMinutes: firstResponseMinutes(leads),
    unreachableRate: unreachableRate(leads),
    staleCount: staleCount(leads),
    lossReasons: lossReasons(leads),
  }
}
