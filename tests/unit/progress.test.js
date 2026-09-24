import { describe, it, expect } from 'vitest'
import {
  periodRange, previousPeriodRange, periodBuckets, summarise, bucketSeries, bySalesperson, pitchNext,
  firstContactStats, waitingForFirstContact,
} from '../../src/domain/progress.js'

// Thursday 24 Sep 2026, 11:00 in Dar es Salaam.
const now = new Date('2026-09-24T11:00:00+03:00')

describe('periodRange — org-local, weeks start on Sunday', () => {
  it('day', () => {
    expect(periodRange('day', now)).toEqual({ start: '2026-09-24', end: '2026-09-24' })
  })

  it('week runs Sunday to Saturday', () => {
    expect(periodRange('week', now)).toEqual({ start: '2026-09-20', end: '2026-09-26' })
  })

  it('a Sunday starts its own week, a Saturday ends it', () => {
    expect(periodRange('week', new Date('2026-09-20T08:00:00+03:00')).start).toBe('2026-09-20')
    expect(periodRange('week', new Date('2026-09-26T22:00:00+03:00')).end).toBe('2026-09-26')
  })

  it('uses Dar es Salaam, not UTC: 01:00 Sunday in Dar is still Saturday in UTC', () => {
    expect(periodRange('week', new Date('2026-09-27T01:00:00+03:00')).start).toBe('2026-09-27')
  })

  it('month and quarter', () => {
    expect(periodRange('month', now)).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(periodRange('quarter', now)).toEqual({ start: '2026-07-01', end: '2026-09-30' })
  })
})

describe('previousPeriodRange', () => {
  it('is the period immediately before', () => {
    expect(previousPeriodRange('day', now)).toEqual({ start: '2026-09-23', end: '2026-09-23' })
    expect(previousPeriodRange('week', now)).toEqual({ start: '2026-09-13', end: '2026-09-19' })
    expect(previousPeriodRange('month', now)).toEqual({ start: '2026-08-01', end: '2026-08-31' })
    expect(previousPeriodRange('quarter', now)).toEqual({ start: '2026-04-01', end: '2026-06-30' })
  })

  it('crosses a year boundary', () => {
    const jan = new Date('2026-01-10T12:00:00+03:00')
    expect(previousPeriodRange('month', jan)).toEqual({ start: '2025-12-01', end: '2025-12-31' })
    expect(previousPeriodRange('quarter', jan)).toEqual({ start: '2025-10-01', end: '2025-12-31' })
  })
})

describe('periodBuckets', () => {
  it('a week splits into 7 days, Sunday first', () => {
    const b = periodBuckets('week', periodRange('week', now))
    expect(b.map((x) => x.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('a month splits into Sunday-weeks, clipped to the month', () => {
    const b = periodBuckets('month', periodRange('month', now))
    // Sep 2026 starts on a Tuesday.
    expect(b.map(({ start, end }) => [start, end])).toEqual([
      ['2026-09-01', '2026-09-05'],
      ['2026-09-06', '2026-09-12'],
      ['2026-09-13', '2026-09-19'],
      ['2026-09-20', '2026-09-26'],
      ['2026-09-27', '2026-09-30'],
    ])
  })

  it('a quarter splits into months; a day does not split', () => {
    expect(periodBuckets('quarter', periodRange('quarter', now)).map((x) => x.label)).toEqual(['Jul', 'Aug', 'Sep'])
    expect(periodBuckets('day', periodRange('day', now))).toEqual([])
  })
})

const act = (leadId, dayKey, outcome = 'spoke', byUserId = 'u1', isVoided = false) => ({ leadId, dayKey, outcome, byUserId, isVoided })
const deal = (leadId, productType, status, closedDayKey, extra = {}) => ({ id: `${leadId}-${productType}`, leadId, productType, status, closedDayKey, closedBy: 'u1', ...extra })

describe('summarise', () => {
  const week = periodRange('week', now)
  const data = {
    activities: [
      act('fatuma', '2026-09-21'),
      act('fatuma', '2026-09-22', 'no_answer'),
      act('fatuma', '2026-09-24'),
      act('aika', '2026-09-23', 'no_answer'),
      act('neema', '2026-09-23', 'spoke', 'u1', true), // voided — does not count
      act('bahati', '2026-09-15'), // last week
    ],
    leads: [{ id: 'aika', dayKey: '2026-09-22' }, { id: 'old', dayKey: '2026-08-01' }],
    deals: [
      deal('fatuma', 'contribution_reminder', 'closed_won', '2026-09-24'),
      deal('fatuma', 'invitation_card', 'closed_won', '2026-09-24'),
      deal('aika', 'committee_invite', 'closed_lost', '2026-09-23', { lostReason: 'price' }),
    ],
  }

  it('counts people, not log entries, and every attempt counts', () => {
    const s = summarise(data, week)
    expect(s.attempts).toBe(4)
    expect(s.workedOn).toBe(2) // fatuma (3 logs) + aika
    expect(s.reached).toBe(1) // only fatuma was actually spoken to
  })

  it('counts deals and the clients behind them', () => {
    const s = summarise(data, week)
    expect(s.won).toBe(2)
    expect(s.wonClients).toBe(1)
    expect(s.lost).toBe(1)
    expect(s.wonByProduct.contribution_reminder).toBe(1)
    expect(s.lostByReason.price).toBe(1)
    expect(s.newLeads).toBe(1)
  })

  it('the previous period sees only its own data', () => {
    const s = summarise(data, previousPeriodRange('week', now))
    expect(s.workedOn).toBe(1)
    expect(s.won).toBe(0)
  })

  it('bucketSeries splits the same data per day', () => {
    const series = bucketSeries(data, periodBuckets('week', week))
    expect(series.find((b) => b.label === 'Thu')).toMatchObject({ workedOn: 1, won: 2 })
    expect(series.find((b) => b.label === 'Wed')).toMatchObject({ workedOn: 1, reached: 0 })
  })

  it('bySalesperson credits whoever logged or closed', () => {
    const rows = bySalesperson({
      activities: [act('a', '2026-09-21', 'spoke', 'u1'), act('b', '2026-09-21', 'busy', 'u2'), act('c', '2026-09-22', 'spoke', 'u2')],
      deals: [deal('a', 'other', 'closed_won', '2026-09-22')],
    }, week)
    expect(rows).toEqual([
      { uid: 'u1', workedOn: 1, reached: 1, won: 1, lost: 0 },
      { uid: 'u2', workedOn: 2, reached: 1, won: 0, lost: 0 },
    ])
  })
})

describe('pitchNext', () => {
  const leads = new Map([
    ['fatuma', { id: 'fatuma', eventDate: new Date('2026-10-12T12:00:00+03:00') }],
    ['neema', { id: 'neema', eventDate: new Date('2026-10-03T12:00:00+03:00') }],
    ['past', { id: 'past', eventDate: new Date('2026-09-01T12:00:00+03:00') }],
    ['noevent', { id: 'noevent', eventDate: null }],
  ])

  it('lists buyers with products still to sell, soonest event first', () => {
    const rows = pitchNext(new Map([
      ['fatuma', [deal('fatuma', 'contribution_reminder', 'closed_won', '2026-09-24'), deal('fatuma', 'invitation_card', 'open', null)]],
      ['neema', [deal('neema', 'invitation_card', 'closed_won', '2026-09-20')]],
      ['noevent', [deal('noevent', 'contribution_card', 'closed_won', '2026-09-20')]],
      ['past', [deal('past', 'contribution_card', 'closed_won', '2026-08-20')]],
    ]), leads, now)

    expect(rows.map((r) => r.lead.id)).toEqual(['neema', 'fatuma', 'noevent'])
    const fatuma = rows.find((r) => r.lead.id === 'fatuma')
    expect(fatuma.taken).toEqual(['contribution_reminder'])
    expect(fatuma.inProgress).toEqual(['invitation_card'])
    expect(fatuma.notYet).toEqual(['committee_invite', 'contribution_card', 'invitation_card'])
  })

  it('leaves out products the client already declined', () => {
    const rows = pitchNext(new Map([
      ['fatuma', [
        deal('fatuma', 'contribution_reminder', 'closed_won', '2026-09-24'),
        deal('fatuma', 'invitation_card', 'closed_lost', '2026-09-24', { lostReason: 'price' }),
      ]],
    ]), leads, now)
    expect(rows[0].notYet).toEqual(['committee_invite', 'contribution_card'])
  })
})

describe('speed to first contact', () => {
  const at = (iso) => new Date(iso)
  const week = periodRange('week', now)

  it('averages the time from being added to the first attempt, answered or not', () => {
    const data = {
      leads: [
        { id: 'a', dayKey: '2026-09-21', createdAt: at('2026-09-21T09:00:00+03:00') },
        { id: 'b', dayKey: '2026-09-22', createdAt: at('2026-09-22T09:00:00+03:00') },
        { id: 'waiting', dayKey: '2026-09-23', createdAt: at('2026-09-23T09:00:00+03:00') },
        { id: 'old', dayKey: '2026-09-01', createdAt: at('2026-09-01T09:00:00+03:00') },
      ],
      activities: [
        { leadId: 'a', at: at('2026-09-21T10:00:00+03:00'), outcome: 'no_answer', isVoided: false },
        { leadId: 'a', at: at('2026-09-21T09:30:00+03:00'), outcome: 'spoke', isVoided: true }, // voided — ignored
        { leadId: 'b', at: at('2026-09-22T12:00:00+03:00'), outcome: 'spoke', isVoided: false },
        { leadId: 'old', at: at('2026-09-21T12:00:00+03:00'), outcome: 'spoke', isVoided: false },
      ],
    }
    // a: 1 h, b: 3 h → 2 h average; 'waiting' is not in the average; 'old' was added before the week.
    expect(firstContactStats(data, week)).toEqual({ contacted: 2, avgMs: 2 * 60 * 60 * 1000 })
  })

  it('no contacted leads means no average, not zero', () => {
    expect(firstContactStats({ leads: [], activities: [] }, week)).toEqual({ contacted: 0, avgMs: null })
  })

  it('counts who is waiting now, and who has waited past 24 hours', () => {
    const hoursAgo = (h) => new Date(now.getTime() - h * 3600000)
    const leads = [
      { nextFollowUpAt: hoursAgo(1), createdAt: hoursAgo(1), lastActivityAt: null },
      { nextFollowUpAt: hoursAgo(30), createdAt: hoursAgo(30), lastActivityAt: null },
      { nextFollowUpAt: new Date(now.getTime() + 3600000), createdAt: hoursAgo(1), lastActivityAt: null }, // scheduled later
    ]
    expect(waitingForFirstContact(leads, now)).toEqual({ waiting: 2, pastWindow: 1 })
  })
})
