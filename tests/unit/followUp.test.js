import { describe, it, expect } from 'vitest'
import {
  resolveQuickChip,
  queueBucket,
  describeFollowUp,
  sortByFollowUp,
  leadBucket,
  describeLead,
  isNeverContacted,
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

  it('a quick-pick read back moments later says what was picked, not one less', () => {
    const later = new Date(now.getTime() + 5000) // the screen re-renders a few seconds on
    expect(describeFollowUp(resolveQuickChip('2h', now), later)).toEqual({ key: 'dueHours', count: 2 })
    expect(describeFollowUp(resolveQuickChip('3d', now), later)).toEqual({ key: 'dueDays', count: 3 })
    expect(describeFollowUp(resolveQuickChip('1w', now), later)).toEqual({ key: 'dueDays', count: 7 })
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

describe('never-contacted leads — New for 24 hours, then overdue', () => {
  const now = new Date('2026-08-24T12:00:00+03:00')
  const minutesAgo = (m) => new Date(now.getTime() - m * 60000)
  const newLead = (createdMinutesAgo, extra = {}) => ({
    createdAt: minutesAgo(createdMinutesAgo),
    nextFollowUpAt: minutesAgo(createdMinutesAgo), // "Now" = due the moment it was added
    lastActivityAt: null,
    ...extra,
  })

  it('a lead added a moment ago is New, not Overdue', () => {
    expect(leadBucket(newLead(0), now)).toBe('new')
    expect(describeLead(newLead(0), now)).toEqual({ key: 'newJustNow', count: 0 })
    expect(describeLead(newLead(10), now)).toEqual({ key: 'newMinutes', count: 10 })
    expect(describeLead(newLead(5 * 60), now)).toEqual({ key: 'newHours', count: 5 })
  })

  it('after 24 hours untouched it turns overdue, and says it was never contacted', () => {
    expect(leadBucket(newLead(24 * 60), now)).toBe('overdue')
    expect(describeLead(newLead(26 * 60), now)).toEqual({ key: 'notContactedDays', count: 1 })
    expect(describeLead(newLead(5 * 24 * 60), now)).toEqual({ key: 'notContactedDays', count: 5 })
  })

  it('a lead scheduled for later is an ordinary upcoming follow-up until then', () => {
    const later = newLead(0, { nextFollowUpAt: new Date('2026-08-25T09:00:00+03:00') })
    expect(leadBucket(later, now)).toBe('upcoming')
    expect(describeLead(later, now).key).toBe('dueHours')
    // ...and New from the moment it falls due, not from when it was added.
    const dueAt = new Date('2026-08-25T09:00:00+03:00')
    expect(leadBucket(later, new Date(dueAt.getTime() + 60 * 60000))).toBe('new')
  })

  it('once any contact is logged, the normal follow-up rules apply', () => {
    const contacted = newLead(5 * 24 * 60, { lastActivityAt: minutesAgo(60), nextFollowUpAt: new Date('2026-08-24T14:00:00+03:00') })
    expect(isNeverContacted(contacted)).toBe(false)
    expect(leadBucket(contacted, now)).toBe('today')
    expect(describeLead(contacted, now)).toEqual({ key: 'dueHours', count: 2 })
  })

  it('an old lead with no createdAt still works from its follow-up time', () => {
    expect(leadBucket({ nextFollowUpAt: minutesAgo(30), lastActivityAt: null }, now)).toBe('new')
    expect(leadBucket(null, now)).toBeNull()
  })
})
