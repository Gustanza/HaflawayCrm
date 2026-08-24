/**
 * The §8 contract. Every formula the product shows a number for is pinned here.
 *
 * The guard-rail tests matter more than the happy paths: a CAC that renders as "0" when
 * nobody was won, or a win rate that falls when an agent adds a prospect, are the kinds of
 * defect that get a dashboard quietly ignored rather than reported as a bug.
 */
import { describe, it, expect } from 'vitest'
import {
  volume,
  contactRate,
  winRate,
  lossRate,
  qualificationRate,
  funnel,
  revenueMinor,
  avgDealValue,
  pipelineValueMinor,
  weightedPipelineMinor,
  adSpendMinor,
  staffCostMinor,
  overheadMinor,
  totalCostMinor,
  cac,
  cpl,
  cpql,
  roas,
  cacBy,
  salesCycleDays,
  firstResponseMinutes,
  unreachableRate,
  staleCount,
  lossReasons,
  ltvToCac,
  cohort,
  closedIn,
  summarise,
  LOW_CONFIDENCE_N,
} from '../../src/domain/metrics.js'
import { STAGE_WIN_PROBABILITY } from '../../src/domain/stages.js'

const day = (n) => new Date(Date.UTC(2026, 7, n, 9, 0, 0))

function lead(overrides = {}) {
  return {
    stage: 'new',
    leadStatus: 'open',
    createdAt: day(1),
    monthKey: '2026-08',
    dealValueMinor: null,
    ...overrides,
  }
}

const won = (value, extra = {}) =>
  lead({ stage: 'won', leadStatus: 'closed_won', dealValueMinor: value, closedAt: day(10), ...extra })
const lost = (extra = {}) =>
  lead({ stage: 'lost', leadStatus: 'closed_lost', closedAt: day(10), ...extra })

describe('volume', () => {
  it('counts each state', () => {
    const leads = [lead(), lead({ firstContactedAt: day(2) }), won(100), lost()]
    expect(volume(leads)).toMatchObject({ created: 4, won: 1, lost: 1 })
  })

  it('counts qualified as REACHED, not currently sitting there', () => {
    // A won lead passed through qualification; excluding it would understate the funnel.
    const leads = [lead({ stage: 'qualified' }), lead({ stage: 'quoted' }), won(100)]
    expect(volume(leads).qualified).toBe(3)
  })
})

describe('contactRate — a ringing phone is not contact', () => {
  it('counts only leads with a recorded conversation', () => {
    const leads = [lead({ firstContactedAt: day(2) }), lead(), lead(), lead()]
    expect(contactRate(leads)).toEqual({ value: 0.25, n: 4 })
  })

  it('returns null, not 0, for an empty set', () => {
    expect(contactRate([])).toEqual({ value: null, n: 0 })
  })
})

describe('winRate divides by CLOSED deals, never by all leads', () => {
  it('is unaffected by adding an open lead', () => {
    const closed = [won(100), won(100), lost()]
    const before = winRate(closed)
    const after = winRate([...closed, lead(), lead(), lead()])
    // Adding prospects must not make an agent look worse — that punishes the exact
    // behaviour the product exists to encourage.
    expect(after.value).toBe(before.value)
    expect(after.value).toBeCloseTo(2 / 3, 10)
  })

  it('returns null when nothing has closed yet', () => {
    expect(winRate([lead(), lead()])).toEqual({ value: null, n: 0 })
  })

  it('win and loss rate sum to 1', () => {
    const leads = [won(100), lost(), lost()]
    expect(winRate(leads).value + lossRate(leads).value).toBeCloseTo(1, 10)
  })
})

describe('qualificationRate', () => {
  it('divides qualified by CONTACTED, not by created', () => {
    const leads = [
      lead({ stage: 'qualified', firstContactedAt: day(2) }),
      lead({ stage: 'contacted', firstContactedAt: day(2) }),
      lead(), // never contacted — not part of the denominator
    ]
    expect(qualificationRate(leads)).toEqual({ value: 0.5, n: 2 })
  })
})

describe('funnel', () => {
  it('reports a drop-off at each step', () => {
    const leads = [
      lead(),
      lead({ firstContactedAt: day(2), stage: 'contacted' }),
      lead({ firstContactedAt: day(2), stage: 'qualified' }),
      won(100, { firstContactedAt: day(2) }),
    ]
    const steps = funnel(leads)
    expect(steps[0]).toMatchObject({ stage: 'created', count: 4, dropoff: null })
    expect(steps[1].count).toBe(3)
    expect(steps[1].dropoff).toBeCloseTo(0.25, 10)
    expect(steps.at(-1)).toMatchObject({ stage: 'won', count: 1 })
  })

  it('never divides by zero', () => {
    for (const step of funnel([])) {
      expect(step.dropoff === null || Number.isFinite(step.dropoff)).toBe(true)
    }
  })
})

describe('money in', () => {
  it('sums only WON deals', () => {
    expect(revenueMinor([won(15000000), won(5000000), lost({ dealValueMinor: 99999999 })])).toBe(
      20000000,
    )
  })

  it('averages over won deals and returns null when there are none', () => {
    expect(avgDealValue([won(10000000), won(20000000)])).toEqual({ value: 15000000, n: 2 })
    expect(avgDealValue([lost()])).toEqual({ value: null, n: 0 })
  })

  it('sums open pipeline separately from revenue', () => {
    const leads = [lead({ dealValueMinor: 5000000 }), won(10000000)]
    expect(pipelineValueMinor(leads)).toBe(5000000)
    expect(revenueMinor(leads)).toBe(10000000)
  })

  it('weights the pipeline by stage probability', () => {
    const leads = [lead({ stage: 'quoted', dealValueMinor: 10000000 })]
    expect(weightedPipelineMinor(leads, STAGE_WIN_PROBABILITY)).toBe(
      Math.round(10000000 * STAGE_WIN_PROBABILITY.quoted),
    )
  })
})

describe('money out, and the §9 policy', () => {
  const expenses = [
    { category: 'ad_spend', amountMinor: 2000000, allocation: { type: 'campaign' } },
    { category: 'salary', amountMinor: 40000000, allocation: { type: 'staff' } },
    { category: 'commission', amountMinor: 5000000, allocation: { type: 'staff' } },
    { category: 'rent', amountMinor: 8000000, allocation: { type: 'overhead' } },
  ]
  const campaignSpend = [{ amountMinor: 3000000 }]

  it('separates the three buckets', () => {
    expect(adSpendMinor(expenses, campaignSpend)).toBe(5000000)
    expect(staffCostMinor(expenses)).toBe(45000000)
    expect(overheadMinor(expenses)).toBe(8000000)
  })

  it('excludes commission from CAC by default (D4)', () => {
    const { total, staff } = totalCostMinor(
      { expenses, campaignSpend },
      { includeSalariesInCAC: true, includeCommissionInCAC: false, overheadMethod: 'by_revenue' },
    )
    expect(staff).toBe(40000000) // salary only
    expect(total).toBe(5000000 + 40000000 + 8000000)
  })

  it('includes commission when the policy says so', () => {
    const { staff } = totalCostMinor(
      { expenses, campaignSpend },
      { includeSalariesInCAC: true, includeCommissionInCAC: true, overheadMethod: 'by_revenue' },
    )
    expect(staff).toBe(45000000)
  })

  it('drops salaries entirely when the policy excludes them (D3)', () => {
    const { total, staff } = totalCostMinor(
      { expenses, campaignSpend },
      { includeSalariesInCAC: false, overheadMethod: 'none' },
    )
    expect(staff).toBe(0)
    expect(total).toBe(5000000) // ad spend only
  })

  it('the policy changes CAC by a factor of several — which is why it is frozen per month', () => {
    const leads = [won(50000000)]
    const withSalaries = cac(leads, { expenses, campaignSpend }, {
      includeSalariesInCAC: true, overheadMethod: 'by_revenue',
    })
    const adsOnly = cac(leads, { expenses, campaignSpend }, {
      includeSalariesInCAC: false, overheadMethod: 'none',
    })
    expect(withSalaries.value).toBeGreaterThan(adsOnly.value * 5)
  })
})

describe('CAC guard rails — §8.5', () => {
  const costs = { expenses: [{ category: 'ad_spend', amountMinor: 9000000 }], campaignSpend: [] }

  it('returns null, NOT zero, when nobody was won', () => {
    const result = cac([lead(), lead()], costs)
    // A CAC of "0" reads as free. The absence of a CAC must be visible as an absence.
    expect(result.value).toBeNull()
    expect(result.n).toBe(0)
  })

  it('never returns Infinity', () => {
    expect(Number.isFinite(cac([], costs).value)).toBe(false)
    expect(cac([], costs).value).toBeNull()
  })

  it('carries the denominator so the UI can print n=', () => {
    const result = cac([won(10000000), won(10000000), won(10000000)], costs)
    expect(result.n).toBe(3)
    expect(result.value).toBe(3000000)
  })

  it('flags a small denominator as low confidence', () => {
    expect(cac([won(1)], costs).lowConfidence).toBe(true)
    expect(cac([won(1), won(1)], costs).lowConfidence).toBe(true)
    const enough = Array.from({ length: LOW_CONFIDENCE_N }, () => won(1))
    expect(cac(enough, costs).lowConfidence).toBe(false)
  })

  it('does not flag zero-won as low confidence — it is no confidence at all', () => {
    expect(cac([], costs).lowConfidence).toBe(false)
    expect(cac([], costs).value).toBeNull()
  })
})

describe('CPL, CPQL and ROAS', () => {
  const costs = { expenses: [{ category: 'ad_spend', amountMinor: 10000000 }], campaignSpend: [] }

  it('divides ad spend by leads and by qualified leads', () => {
    const leads = [lead(), lead(), lead({ stage: 'qualified', firstContactedAt: day(2) })]
    expect(cpl(leads, costs).value).toBe(Math.round(10000000 / 3))
    expect(cpql(leads, costs).value).toBe(10000000)
  })

  it('returns null for an empty period rather than dividing by zero', () => {
    expect(cpl([], costs).value).toBeNull()
    expect(cpql([], costs).value).toBeNull()
    expect(roas([won(100)], 0).value).toBeNull()
  })

  it('computes ROAS as revenue over spend', () => {
    expect(roas([won(30000000)], 10000000).value).toBe(3)
  })
})

describe('cacBy — the per-staff and per-campaign breakdown', () => {
  const leads = [
    won(20000000, { ownerId: 'a1' }),
    lost({ ownerId: 'a1' }),
    won(10000000, { ownerId: 'a2' }),
    lead({ ownerId: 'a2' }),
  ]
  const costsFor = (uid) => ({
    expenses: [{ category: 'salary', amountMinor: uid === 'a1' ? 8000000 : 4000000 }],
    campaignSpend: [],
  })

  it('buckets by the key and computes a CAC per bucket', () => {
    const rows = cacBy(leads, (l) => l.ownerId, costsFor)
    const a1 = rows.find((r) => r.key === 'a1')
    expect(a1).toMatchObject({ leads: 2, won: 1, revenueMinor: 20000000 })
    expect(a1.value).toBe(8000000)
    expect(a1.lowConfidence).toBe(true) // one won deal is not a measurement
  })

  it('skips leads with no key rather than inventing an "undefined" bucket', () => {
    const rows = cacBy([...leads, lead({ ownerId: null })], (l) => l.ownerId, costsFor)
    expect(rows.map((r) => r.key)).toEqual(['a1', 'a2'])
  })

  it('gives a bucket with no wins a null CAC, not zero', () => {
    const rows = cacBy([lead({ ownerId: 'a3' })], (l) => l.ownerId, costsFor)
    expect(rows[0].value).toBeNull()
  })
})

describe('sales cycle and response time use the MEDIAN', () => {
  it('is not dragged by one outlier', () => {
    const leads = [
      won(1, { createdAt: day(1), closedAt: day(3) }),
      won(1, { createdAt: day(1), closedAt: day(4) }),
      won(1, { createdAt: day(1), closedAt: day(5) }),
      won(1, { createdAt: day(1), closedAt: new Date(Date.UTC(2027, 7, 1)) }), // a year
    ]
    const result = salesCycleDays(leads)
    expect(result.n).toBe(4)
    // The mean would be ~93 days; the median stays in the real range.
    expect(result.value).toBeLessThan(10)
  })

  it('returns null when nothing has closed', () => {
    expect(salesCycleDays([lead()])).toEqual({ value: null, n: 0 })
  })

  it('measures first response in minutes from creation', () => {
    const created = new Date(Date.UTC(2026, 7, 1, 9, 0))
    const leads = [
      lead({ createdAt: created, firstContactedAt: new Date(Date.UTC(2026, 7, 1, 9, 20)) }),
      lead({ createdAt: created, firstContactedAt: new Date(Date.UTC(2026, 7, 1, 10, 0)) }),
    ]
    expect(firstResponseMinutes(leads)).toEqual({ value: 40, n: 2 })
  })

  it('ignores leads never contacted rather than counting them as instant', () => {
    expect(firstResponseMinutes([lead()])).toEqual({ value: null, n: 0 })
  })
})

describe('health signals', () => {
  it('measures the unreachable share of OPEN leads only', () => {
    const leads = [lead({ stage: 'unreachable' }), lead({ stage: 'contacted' }), won(1)]
    expect(unreachableRate(leads)).toEqual({ value: 0.5, n: 2 })
  })

  it('counts stale leads whose next action has passed', () => {
    const now = new Date(Date.UTC(2026, 7, 10))
    const leads = [
      lead({ nextActionAt: new Date(Date.UTC(2026, 7, 9)) }),
      lead({ nextActionAt: new Date(Date.UTC(2026, 7, 11)) }),
      lead({ nextActionAt: null }),
      won(1, { nextActionAt: new Date(Date.UTC(2026, 7, 1)) }), // closed: not stale
    ]
    expect(staleCount(leads, now)).toBe(1)
  })

  it('ranks loss reasons with their share', () => {
    const leads = [lost({ lossReason: 'price' }), lost({ lossReason: 'price' }), lost({ lossReason: 'no_budget' })]
    const rows = lossReasons(leads)
    expect(rows[0]).toMatchObject({ reason: 'price', count: 2 })
    expect(rows[0].share).toBeCloseTo(2 / 3, 10)
  })

  it('defaults a missing loss reason to "other" rather than dropping the lead', () => {
    expect(lossReasons([lost()])[0].reason).toBe('other')
  })

  it('returns null LTV:CAC when CAC is unknown', () => {
    expect(ltvToCac(100, 0).value).toBeNull()
    expect(ltvToCac(30000000, 10000000).value).toBe(3)
  })
})

describe('cohort vs period — §8.8', () => {
  const leads = [
    lead({ monthKey: '2026-07', createdAt: new Date(Date.UTC(2026, 6, 5)) }),
    won(100, { monthKey: '2026-07', createdAt: new Date(Date.UTC(2026, 6, 20)), closedAt: day(10) }),
    won(100, { monthKey: '2026-08', createdAt: day(2), closedAt: day(12) }),
  ]

  it('gives different answers, which is the entire point of the distinction', () => {
    // A lead created in July but won in August belongs to July's COHORT and August's PERIOD.
    expect(cohort(leads, '2026-07')).toHaveLength(2)
    expect(closedIn(leads, '2026-08')).toHaveLength(2)
  })
})

describe('summarise', () => {
  it('returns every headline figure with no NaN or Infinity anywhere', () => {
    const result = summarise([lead(), won(15000000), lost()], {
      expenses: [{ category: 'ad_spend', amountMinor: 5000000 }],
      campaignSpend: [],
    })

    const scan = (value) => {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `non-finite: ${value}`).toBe(true)
      } else if (Array.isArray(value)) {
        value.forEach(scan)
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(scan)
      }
    }
    scan(result)

    expect(result.won).toBe(1)
    expect(result.cac.value).toBe(5000000)
  })

  it('survives a completely empty period', () => {
    const result = summarise([], { expenses: [], campaignSpend: [] })
    expect(result.created).toBe(0)
    expect(result.cac.value).toBeNull()
    expect(result.winRate.value).toBeNull()
    expect(() => summarise([])).not.toThrow()
  })
})
