import { describe, it, expect } from 'vitest'
import {
  urgencyScore,
  urgencyFromEventDate,
  urgencyBand,
  qualificationScore,
  engagementScore,
  priorityScore,
  recomputeScores,
} from '../../src/domain/scoring.js'

const NOW = new Date('2026-08-24T09:00:00+03:00')
const inDays = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

describe('urgencyScore — the event-date clock (P2)', () => {
  it('scores each documented band', () => {
    expect(urgencyScore(0)).toBe(100)
    expect(urgencyScore(7)).toBe(100)
    expect(urgencyScore(8)).toBe(85)
    expect(urgencyScore(14)).toBe(85)
    expect(urgencyScore(15)).toBe(70)
    expect(urgencyScore(30)).toBe(70)
    expect(urgencyScore(31)).toBe(50)
    expect(urgencyScore(60)).toBe(50)
    expect(urgencyScore(61)).toBe(30)
    expect(urgencyScore(90)).toBe(30)
    expect(urgencyScore(91)).toBe(10)
    expect(urgencyScore(365)).toBe(10)
  })

  it('scores a past event zero — the invitations were needed last week', () => {
    expect(urgencyScore(-1)).toBe(0)
    expect(urgencyScore(-100)).toBe(0)
  })

  it('scores an unknown date low but not zero — it is still workable', () => {
    expect(urgencyScore(null)).toBe(10)
    expect(urgencyScore(undefined)).toBe(10)
  })

  it('never decreases as the event gets closer', () => {
    let previous = -1
    for (let d = 400; d >= 0; d -= 1) {
      const score = urgencyScore(d)
      expect(score, `urgency dropped between ${d + 1} and ${d} days`).toBeGreaterThanOrEqual(previous)
      previous = score
    }
  })

  it('computes straight from an event date', () => {
    expect(urgencyFromEventDate(inDays(3), NOW)).toBe(100)
    expect(urgencyFromEventDate(inDays(200), NOW)).toBe(10)
    expect(urgencyFromEventDate(null, NOW)).toBe(10)
  })
})

describe('urgencyBand', () => {
  it('bands for the urgency board', () => {
    expect(urgencyBand(3)).toBe('critical')
    expect(urgencyBand(10)).toBe('high')
    expect(urgencyBand(25)).toBe('medium')
    expect(urgencyBand(120)).toBe('low')
    expect(urgencyBand(-2)).toBe('passed')
    expect(urgencyBand(null)).toBe('unknown')
  })
})

describe('qualificationScore — BEDS', () => {
  it('scores an empty lead zero', () => {
    expect(qualificationScore({})).toBe(0)
    expect(qualificationScore(null)).toBe(0)
    expect(qualificationScore({ qualification: {} })).toBe(0)
  })

  it('scores a fully-qualified lead 100', () => {
    expect(
      qualificationScore({
        guestCountEstimate: 600,
        qualification: {
          budgetBand: '500k+',
          decisionMakerContactId: 'c1',
          interestedProductIds: ['p1'],
        },
      }),
    ).toBe(100)
  })

  it('treats budgetBand "unknown" as no answer', () => {
    const withUnknown = qualificationScore({ qualification: { budgetBand: 'unknown' } })
    expect(withUnknown).toBe(0)
  })

  it('weights budget most heavily', () => {
    const budgetOnly = qualificationScore({ qualification: { budgetBand: '500k+' } })
    const scopeOnly = qualificationScore({ qualification: { interestedProductIds: ['p1'] } })
    const decisionOnly = qualificationScore({ qualification: { decisionMakerContactId: 'c1' } })
    expect(budgetOnly).toBeGreaterThan(scopeOnly)
    expect(budgetOnly).toBeGreaterThan(decisionOnly)
  })

  it('rewards a bigger guest list', () => {
    const small = qualificationScore({ guestCountEstimate: 40, qualification: {} })
    const large = qualificationScore({ guestCountEstimate: 600, qualification: {} })
    expect(large).toBeGreaterThan(small)
  })

  it('stays within 0..100 for any input', () => {
    const cases = [
      {},
      { guestCountEstimate: -5, qualification: { budgetBand: 'nonsense' } },
      { guestCountEstimate: 1e9, qualification: { budgetBand: '500k+', decisionMakerContactId: 'x', interestedProductIds: ['a', 'b'] } },
      { qualification: { interestedProductIds: [] } },
    ]
    for (const lead of cases) {
      const score = qualificationScore(lead)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('never throws on malformed input', () => {
    expect(() => qualificationScore(undefined)).not.toThrow()
    expect(() => qualificationScore({ qualification: { interestedProductIds: 'not-an-array' } })).not.toThrow()
  })
})

describe('engagementScore', () => {
  it('is zero for a lead nobody has ever spoken to', () => {
    expect(engagementScore({}, NOW)).toBe(0)
  })

  it('rewards a recent conversation', () => {
    expect(engagementScore({ lastContactedAt: inDays(-1) }, NOW)).toBe(100)
    expect(engagementScore({ lastContactedAt: inDays(-5) }, NOW)).toBe(75)
    expect(engagementScore({ lastContactedAt: inDays(-10) }, NOW)).toBe(50)
    expect(engagementScore({ lastContactedAt: inDays(-60) }, NOW)).toBe(10)
  })

  it('penalises a run of unanswered calls', () => {
    const base = engagementScore({ lastContactedAt: inDays(-1) }, NOW)
    const chased = engagementScore({ lastContactedAt: inDays(-1), consecutiveNoAnswer: 2 }, NOW)
    expect(chased).toBe(base - 30)
  })

  it('caps the penalty rather than going negative', () => {
    expect(engagementScore({ consecutiveNoAnswer: 99 }, NOW)).toBe(0)
    expect(engagementScore({ lastContactedAt: inDays(-1), consecutiveNoAnswer: 99 }, NOW)).toBe(40)
  })

  it('stays within 0..100', () => {
    for (const noAnswer of [0, 1, 4, 50]) {
      for (const contactedDaysAgo of [0, 3, 20, 400]) {
        const score = engagementScore(
          { lastContactedAt: inDays(-contactedDaysAgo), consecutiveNoAnswer: noAnswer },
          NOW,
        )
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('priorityScore — what the work queue sorts on', () => {
  it('accepts pre-computed components', () => {
    expect(priorityScore({ urgency: 100, qualification: 100, engagement: 100 })).toBe(100)
    expect(priorityScore({ urgency: 0, qualification: 0, engagement: 0 })).toBe(0)
    expect(priorityScore({ urgency: 100, qualification: 0, engagement: 0 })).toBe(50)
  })

  it('computes from a lead document', () => {
    const lead = {
      eventDate: inDays(5),
      guestCountEstimate: 600, // 500+ is the top guest band; 400 scores 80, not 100
      qualification: { budgetBand: '500k+', decisionMakerContactId: 'c1', interestedProductIds: ['p'] },
      lastContactedAt: inDays(-1),
    }
    expect(priorityScore(lead, NOW)).toBe(100)
  })

  it('pins a lead inside a fortnight near the top whatever else we know', () => {
    // The urgency floor. Without it the §8.7 blend alone lets a distant, well-qualified
    // lead outrank an imminent unknown one — see the comment on URGENCY_FLOORS.
    expect(priorityScore({ eventDate: inDays(3), qualification: {} }, NOW)).toBeGreaterThanOrEqual(90)
    expect(priorityScore({ eventDate: inDays(12), qualification: {} }, NOW)).toBeGreaterThanOrEqual(75)
    // The floor must not lift a lead whose event has already passed.
    expect(priorityScore({ eventDate: inDays(-3), qualification: {} }, NOW)).toBeLessThan(75)
  })

  it('ranks an imminent event above a distant well-qualified one — the P2 argument', () => {
    const imminentThinLead = {
      eventDate: inDays(9),
      qualification: {},
    }
    const distantPerfectLead = {
      eventDate: inDays(210),
      guestCountEstimate: 600,
      qualification: { budgetBand: '500k+', decisionMakerContactId: 'c1', interestedProductIds: ['p'] },
      lastContactedAt: inDays(-1),
    }
    expect(priorityScore(imminentThinLead, NOW)).toBeGreaterThan(priorityScore(distantPerfectLead, NOW))
  })

  it('stays within 0..100 and never throws', () => {
    expect(priorityScore({}, NOW)).toBeGreaterThanOrEqual(0)
    expect(priorityScore({}, NOW)).toBeLessThanOrEqual(100)
    expect(() => priorityScore(null, NOW)).not.toThrow()
    expect(() => priorityScore(undefined, NOW)).not.toThrow()
  })
})

describe('recomputeScores', () => {
  it('returns every denormalised field a lead write needs', () => {
    const result = recomputeScores({ eventDate: inDays(10), qualification: {} }, NOW)
    expect(result).toHaveProperty('daysToEvent', 10)
    expect(result).toHaveProperty('urgencyScore', 85)
    expect(result).toHaveProperty('qualificationScore')
    expect(result).toHaveProperty('priorityScore')
  })

  it('shows urgency rising as the same lead ages — why the nightly job exists', () => {
    const lead = { eventDate: inDays(40), qualification: {} }
    const today = recomputeScores(lead, NOW)
    const inTwentyDays = recomputeScores(lead, inDays(20))
    expect(inTwentyDays.urgencyScore).toBeGreaterThan(today.urgencyScore)
    expect(inTwentyDays.priorityScore).toBeGreaterThan(today.priorityScore)
  })

  it('handles a lead with no event date', () => {
    const result = recomputeScores({ qualification: {} }, NOW)
    expect(result.daysToEvent).toBeNull()
    expect(result.urgencyScore).toBe(10)
  })
})
