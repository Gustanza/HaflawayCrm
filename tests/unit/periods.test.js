import { describe, it, expect } from 'vitest'
import {
  ORG_TIMEZONE,
  toDate,
  dayKey,
  weekKey,
  monthKey,
  periodKeys,
  daysBetween,
  daysToEvent,
  startOfOrgDay,
  endOfOrgDay,
  monthBounds,
  recentMonthKeys,
} from '../../src/domain/periods.js'

describe('toDate', () => {
  it('passes through a Date', () => {
    const d = new Date('2026-08-24T09:00:00Z')
    expect(toDate(d)).toBe(d)
  })

  it('unwraps a Firestore-like Timestamp', () => {
    const d = new Date('2026-08-24T09:00:00Z')
    expect(toDate({ toDate: () => d })).toBe(d)
  })

  it('parses ISO strings and millis', () => {
    expect(toDate('2026-08-24T09:00:00Z').toISOString()).toBe('2026-08-24T09:00:00.000Z')
    expect(toDate(1756026000000)).toBeInstanceOf(Date)
  })

  it('returns null for null, undefined and garbage', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate(undefined)).toBeNull()
    expect(toDate('not a date')).toBeNull()
    expect(toDate(new Date('nope'))).toBeNull()
  })
})

describe('dayKey — org timezone is UTC+3', () => {
  it('uses the org day, not the UTC day, late in the evening', () => {
    // 22:30 UTC on the 24th is 01:30 on the 25th in Dar es Salaam.
    expect(dayKey('2026-08-24T22:30:00Z')).toBe('2026-08-25')
  })

  it('uses the org day early in the morning', () => {
    // 02:00 UTC on the 24th is 05:00 on the 24th in Dar es Salaam.
    expect(dayKey('2026-08-24T02:00:00Z')).toBe('2026-08-24')
  })

  it('handles the exact org midnight boundary', () => {
    expect(dayKey('2026-08-24T21:00:00Z')).toBe('2026-08-25') // 00:00 org time
    expect(dayKey('2026-08-24T20:59:59Z')).toBe('2026-08-24') // 23:59:59 org time
  })

  it('rolls the month and year over correctly', () => {
    expect(dayKey('2026-12-31T21:00:00Z')).toBe('2027-01-01')
    expect(monthKey('2026-12-31T21:00:00Z')).toBe('2027-01')
  })

  it('returns null for missing input', () => {
    expect(dayKey(null)).toBeNull()
    expect(monthKey(undefined)).toBeNull()
    expect(weekKey('rubbish')).toBeNull()
  })
})

describe('weekKey — ISO 8601', () => {
  it('numbers a known mid-year week', () => {
    // Mon 24 Aug 2026 is in ISO week 35.
    expect(weekKey('2026-08-24T09:00:00+03:00')).toBe('2026-W35')
    expect(weekKey('2026-08-30T09:00:00+03:00')).toBe('2026-W35') // Sunday, same ISO week
    expect(weekKey('2026-08-31T09:00:00+03:00')).toBe('2026-W36') // next Monday
  })

  it('assigns early-January days to the previous ISO week-year when required', () => {
    // Fri 1 Jan 2027 falls in ISO week 53 of 2026.
    expect(weekKey('2027-01-01T09:00:00+03:00')).toBe('2026-W53')
  })

  it('assigns late-December days to the next ISO week-year when required', () => {
    // Mon 29 Dec 2025 falls in ISO week 1 of 2026.
    expect(weekKey('2025-12-29T09:00:00+03:00')).toBe('2026-W01')
  })

  it('zero-pads single-digit weeks', () => {
    expect(weekKey('2026-01-08T09:00:00+03:00')).toBe('2026-W02')
  })
})

describe('periodKeys', () => {
  it('returns all three keys for one instant', () => {
    expect(periodKeys('2026-08-24T09:00:00+03:00')).toEqual({
      dayKey: '2026-08-24',
      weekKey: '2026-W35',
      monthKey: '2026-08',
    })
  })
})

describe('daysBetween / daysToEvent — calendar days, not 24h blocks', () => {
  it('counts an event tomorrow morning as 1 day away, even if only hours out', () => {
    const now = '2026-08-24T20:00:00+03:00' // 8pm today, org time
    const event = '2026-08-25T08:00:00+03:00' // 8am tomorrow — 12 hours later
    expect(daysToEvent(event, new Date(now))).toBe(1)
  })

  it('counts the same org day as 0 regardless of time', () => {
    expect(daysToEvent('2026-08-24T23:00:00+03:00', new Date('2026-08-24T06:00:00+03:00'))).toBe(0)
  })

  it('returns a negative number for past events', () => {
    expect(daysToEvent('2026-08-20T09:00:00+03:00', new Date('2026-08-24T09:00:00+03:00'))).toBe(-4)
  })

  it('crosses month boundaries', () => {
    expect(daysBetween('2026-08-30T09:00:00+03:00', '2026-09-02T09:00:00+03:00')).toBe(3)
  })

  it('returns null when either side is missing', () => {
    expect(daysToEvent(null)).toBeNull()
    expect(daysBetween(null, new Date())).toBeNull()
  })
})

describe('startOfOrgDay / endOfOrgDay', () => {
  it('anchors to 21:00 UTC the previous day (00:00 UTC+3)', () => {
    expect(startOfOrgDay('2026-08-24T12:00:00Z').toISOString()).toBe('2026-08-23T21:00:00.000Z')
  })

  it('gives an exclusive end exactly 24h after the start', () => {
    const s = startOfOrgDay('2026-08-24T12:00:00Z')
    const e = endOfOrgDay('2026-08-24T12:00:00Z')
    expect(e - s).toBe(24 * 60 * 60 * 1000)
  })

  it('brackets every instant of its own org day', () => {
    const probe = '2026-08-24T22:30:00Z' // org day is the 25th
    const s = startOfOrgDay(probe)
    const e = endOfOrgDay(probe)
    const t = new Date(probe)
    expect(t >= s && t < e).toBe(true)
    expect(dayKey(s)).toBe('2026-08-25')
  })
})

describe('monthBounds', () => {
  it('brackets a normal month in org time', () => {
    const { start, end } = monthBounds('2026-08')
    expect(start.toISOString()).toBe('2026-07-31T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-31T21:00:00.000Z')
  })

  it('rolls December into the next January', () => {
    const { start, end } = monthBounds('2026-12')
    expect(start.toISOString()).toBe('2026-11-30T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-12-31T21:00:00.000Z')
  })

  it('rejects malformed keys', () => {
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds('nonsense')).toBeNull()
    expect(monthBounds('2026-00')).toBeNull()
  })
})

describe('recentMonthKeys', () => {
  it('returns N months oldest-first, including the current one', () => {
    expect(recentMonthKeys(3, new Date('2026-08-24T09:00:00+03:00'))).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
    ])
  })

  it('walks back across a year boundary', () => {
    expect(recentMonthKeys(3, new Date('2026-02-10T09:00:00+03:00'))).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('walks back more than a full year', () => {
    const keys = recentMonthKeys(14, new Date('2026-08-24T09:00:00+03:00'))
    expect(keys).toHaveLength(14)
    expect(keys[0]).toBe('2025-07')
    expect(keys[13]).toBe('2026-08')
  })
})

describe('org timezone constant', () => {
  it('is Dar es Salaam', () => {
    expect(ORG_TIMEZONE).toBe('Africa/Dar_es_Salaam')
  })
})
