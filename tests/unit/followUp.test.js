import { describe, it, expect } from 'vitest'
import {
  resolveQuickChip,
  queueBucket,
  describeFollowUp,
  sortByFollowUp,
} from '../../src/domain/followUp.js'

describe('resolveQuickChip', () => {
  const now = new Date('2026-08-24T18:00:00+03:00') // 6pm org time

  it('2h adds exactly two hours', () => {
    expect(resolveQuickChip('2h', now).toISOString()).toBe(
      new Date('2026-08-24T20:00:00+03:00').toISOString(),
    )
  })

  it('tomorrow9am anchors to the org-local next day at 9am, even late at night', () => {
    const lateNight = new Date('2026-08-24T23:30:00+03:00')
    expect(resolveQuickChip('tomorrow9am', lateNight).toISOString()).toBe(
      new Date('2026-08-25T09:00:00+03:00').toISOString(),
    )
  })

  it('3d and 1w add whole days', () => {
    expect(resolveQuickChip('3d', now).toISOString()).toBe(
      new Date('2026-08-27T18:00:00+03:00').toISOString(),
    )
    expect(resolveQuickChip('1w', now).toISOString()).toBe(
      new Date('2026-08-31T18:00:00+03:00').toISOString(),
    )
  })

  it('returns null for an unknown chip or unreadable now', () => {
    expect(resolveQuickChip('nonsense', now)).toBeNull()
    expect(resolveQuickChip('2h', 'garbage')).toBeNull()
  })
})

describe('queueBucket', () => {
  const now = new Date('2026-08-24T12:00:00+03:00')

  it('is overdue when the follow-up is in the past', () => {
    expect(queueBucket('2026-08-24T09:00:00+03:00', now)).toBe('overdue')
    expect(queueBucket('2026-08-01T09:00:00+03:00', now)).toBe('overdue')
  })

  it('is today when due later the same org-local day', () => {
    expect(queueBucket('2026-08-24T23:00:00+03:00', now)).toBe('today')
  })

  it('is upcoming when due a future day', () => {
    expect(queueBucket('2026-08-25T00:00:01+03:00', now)).toBe('upcoming')
    expect(queueBucket('2026-09-01T09:00:00+03:00', now)).toBe('upcoming')
  })

  it('is null with no follow-up set', () => {
    expect(queueBucket(null, now)).toBeNull()
    expect(queueBucket(undefined, now)).toBeNull()
  })
})

describe('describeFollowUp', () => {
  const now = new Date('2026-08-24T12:00:00+03:00')

  it('describes overdue in days, then hours, then "now"', () => {
    expect(describeFollowUp('2026-08-20T12:00:00+03:00', now)).toEqual({ key: 'overdueDays', count: 4 })
    expect(describeFollowUp('2026-08-24T09:00:00+03:00', now)).toEqual({ key: 'overdueHours', count: 3 })
    expect(describeFollowUp('2026-08-24T11:59:30+03:00', now)).toEqual({ key: 'overdueNow', count: 0 })
  })

  it('describes upcoming in days, then hours, then minutes', () => {
    expect(describeFollowUp('2026-08-28T12:00:00+03:00', now)).toEqual({ key: 'dueDays', count: 4 })
    expect(describeFollowUp('2026-08-24T15:00:00+03:00', now)).toEqual({ key: 'dueHours', count: 3 })
    expect(describeFollowUp('2026-08-24T12:05:00+03:00', now)).toEqual({ key: 'dueMinutes', count: 5 })
  })

  it('a follow-up seconds away still reports at least 1 minute, not 0', () => {
    expect(describeFollowUp('2026-08-24T12:00:30+03:00', now)).toEqual({ key: 'dueMinutes', count: 1 })
  })
})

describe('sortByFollowUp', () => {
  const now = new Date('2026-08-24T12:00:00+03:00')

  it('orders most-overdue first, then soonest-upcoming, then unscheduled last', () => {
    const leads = [
      { id: 'upcoming-far', nextFollowUpAt: '2026-08-30T12:00:00+03:00' },
      { id: 'none' },
      { id: 'overdue-mild', nextFollowUpAt: '2026-08-24T10:00:00+03:00' },
      { id: 'overdue-severe', nextFollowUpAt: '2026-08-01T10:00:00+03:00' },
      { id: 'upcoming-soon', nextFollowUpAt: '2026-08-25T09:00:00+03:00' },
    ]

    const sorted = sortByFollowUp(leads, now)
    expect(sorted.map((l) => l.id)).toEqual([
      'overdue-severe',
      'overdue-mild',
      'upcoming-soon',
      'upcoming-far',
      'none',
    ])
  })

  it('does not mutate the input array', () => {
    const leads = [{ id: 'a', nextFollowUpAt: '2026-08-25T00:00:00+03:00' }, { id: 'b' }]
    const copy = [...leads]
    sortByFollowUp(leads, now)
    expect(leads).toEqual(copy)
  })
})
