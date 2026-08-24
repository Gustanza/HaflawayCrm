/**
 * Regression suite — every case here is a defect that was found by executing the code,
 * not by reading it. Each test names the failure it prevents. Do not delete one because
 * it "looks obvious": each of these passed review once already.
 *
 * NOTE: the unit suite runs with TZ pinned to America/New_York (vite.config.js). Several
 * of these tests pass trivially on a UTC+3 machine, which is exactly how the original
 * timezone bugs survived.
 */
import { describe, it, expect } from 'vitest'
import {
  startOfOrgDay,
  endOfOrgDay,
  dayKey,
  weekKey,
  monthKey,
  periodKeys,
  toDate,
  monthBounds,
  recentMonthKeys,
} from '../../src/domain/periods.js'
import {
  toMinor,
  multiplyMinor,
  divideMinor,
  percentOfMinor,
  addMinor,
  formatMoney,
  formatMoneyForExport,
  allocateMinor,
  isValidMinor,
} from '../../src/domain/money.js'
import { normalizePhone, samePhone, carrierHint } from '../../src/domain/phone.js'

describe('an org day is exactly 24h in every host timezone', () => {
  // Was: endOfOrgDay used date-fns addDays on a plain Date, advancing the day in the HOST
  // zone. In a DST zone the org "day" became 23h or 25h on transition dates, silently
  // dropping or double-counting leads in every daily rollup.
  const dstProbes = [
    '2025-03-09T10:00:00+03:00', // US spring forward
    '2025-11-02T10:00:00+03:00', // US fall back
    '2025-03-30T10:00:00+03:00', // EU spring forward
    '2025-10-26T10:00:00+03:00', // EU fall back
  ]

  it.each(dstProbes)('spans exactly 24h across %s', (probe) => {
    const d = new Date(probe)
    expect(endOfOrgDay(d) - startOfOrgDay(d)).toBe(24 * 60 * 60 * 1000)
  })

  it.each(dstProbes)('brackets every instant of its own org day at %s', (probe) => {
    const d = new Date(probe)
    const start = startOfOrgDay(d)
    const end = endOfOrgDay(d)
    const key = dayKey(d)
    // A lead logged at 23:30 org time belongs to that org day and must fall in the window.
    const lateInDay = new Date(end.getTime() - 30 * 60 * 1000)
    expect(dayKey(lateInDay)).toBe(key)
    expect(lateInDay >= start && lateInDay < end).toBe(true)
    // The first instant of the next window must not still be this day.
    expect(dayKey(end)).not.toBe(key)
  })

  it('rolls a month boundary correctly', () => {
    const d = new Date('2026-08-31T22:00:00+03:00')
    expect(dayKey(d)).toBe('2026-08-31')
    expect(dayKey(endOfOrgDay(d))).toBe('2026-09-01')
  })
})

describe('NaN never reaches a period key', () => {
  // Was: the number branch of toDate skipped the NaN guard, so a Date.parse() failure —
  // the obvious idiom in the CSV importer — produced dayKey "NaN-NaN-NaN" on a real
  // document, filed under a bucket no query would ever find.
  it('rejects a NaN or infinite millisecond value', () => {
    expect(toDate(Date.parse('not a date'))).toBeNull()
    expect(toDate(NaN)).toBeNull()
    expect(toDate(Infinity)).toBeNull()
    expect(toDate(-Infinity)).toBeNull()
  })

  it('returns null keys rather than "NaN-NaN-NaN"', () => {
    expect(dayKey(NaN)).toBeNull()
    expect(weekKey(NaN)).toBeNull()
    expect(monthKey(NaN)).toBeNull()
    expect(periodKeys(NaN)).toEqual({ dayKey: null, weekKey: null, monthKey: null })
    expect(startOfOrgDay(NaN)).toBeNull()
    expect(endOfOrgDay(NaN)).toBeNull()
  })
})

describe('monthBounds does not fail open on the wrong key type', () => {
  // Was: split('-') took the first two parts, so a dayKey silently returned a whole month.
  it('rejects a dayKey', () => {
    expect(monthBounds('2026-08-24')).toBeNull()
    expect(monthBounds('2026-08-99')).toBeNull()
  })

  it('rejects a loosely-formatted month', () => {
    expect(monthBounds('2026-8')).toBeNull()
    expect(monthBounds('')).toBeNull()
    expect(monthBounds(null)).toBeNull()
  })

  it('still accepts a well-formed month key', () => {
    expect(monthBounds('2026-08')).not.toBeNull()
  })
})

describe('recentMonthKeys follows the module error convention', () => {
  // Was: the only function in periods.js that threw, and with an internal-looking message.
  it('returns an empty array for unreadable input instead of throwing', () => {
    expect(recentMonthKeys(3, 'rubbish')).toEqual([])
    expect(recentMonthKeys(3, null)).toEqual([])
    expect(recentMonthKeys(0)).toEqual([])
    expect(recentMonthKeys(-1)).toEqual([])
    expect(() => recentMonthKeys(3, 'rubbish')).not.toThrow()
  })
})

describe('money rounds half away from zero, so corrections reverse exactly', () => {
  // Was: Math.round rounds half toward +Infinity, so +166.5 became 167 but -166.5 became
  // -166. Under P4 a correction is a new negative entry, so every reversal of an odd
  // half-unit left a stranded senti in a ledger that has to survive an argument.
  it('reverses a percentage exactly', () => {
    expect(addMinor(percentOfMinor(333, 50), percentOfMinor(-333, 50))).toBe(0)
  })

  it('is symmetric for multiply and divide', () => {
    expect(multiplyMinor(333, 0.5)).toBe(167)
    expect(multiplyMinor(-333, 0.5)).toBe(-167)
    expect(divideMinor(5, 2)).toBe(3)
    expect(divideMinor(-5, 2)).toBe(-3)
  })

  it('nets to zero across a thousand reversals', () => {
    let net = 0
    for (let amount = -500; amount <= 500; amount++) {
      net += multiplyMinor(amount, 0.5) + multiplyMinor(-amount, 0.5)
    }
    expect(net).toBe(0)
  })
})

describe('money rejects bad rates instead of booking a silent zero', () => {
  // Was: percentOfMinor computed `percent / 100` first, and null/100 is 0, so a blank
  // commission field became a deliberate-looking 0% while undefined threw. Three flavours
  // of bad input, three behaviours, in a function that moves money.
  it('throws on a missing or non-numeric percentage', () => {
    expect(() => percentOfMinor(150000, null)).toThrow(TypeError)
    expect(() => percentOfMinor(150000, undefined)).toThrow(TypeError)
    expect(() => percentOfMinor(150000, '50')).toThrow(TypeError)
    expect(() => percentOfMinor(150000, NaN)).toThrow(TypeError)
  })

  it('throws on a non-numeric factor rather than coercing', () => {
    expect(() => multiplyMinor(150000, '2')).toThrow(TypeError)
    expect(divideMinor(150000, null)).toBeNull()
  })

  it('still accepts genuine numbers', () => {
    expect(percentOfMinor(15000000, 10)).toBe(1500000)
    expect(percentOfMinor(15000000, 0)).toBe(0)
  })
})

describe('toMinor validates rather than sanitises', () => {
  // Was: delete every character that is not a digit, dot or minus, then trust Number().
  // That turned an accounting negative into a positive — a sign flip on money, in exactly
  // the format CSV expense exports use.
  it('reads a parenthesised accounting negative as negative', () => {
    expect(toMinor('(1500)')).toBe(-150000)
    expect(toMinor('(1,500)')).toBe(-150000)
    expect(toMinor('(TZS 1,500)')).toBe(-150000)
  })

  it('rejects notation and units it cannot read unambiguously', () => {
    expect(toMinor('1e5')).toBeNull()
    expect(toMinor('1.5e3')).toBeNull()
    expect(toMinor('20%')).toBeNull()
    expect(toMinor('1.2.3')).toBeNull()
    expect(toMinor('12 apples')).toBeNull()
    expect(toMinor('--5')).toBeNull()
  })

  it('still reads the formats people actually type', () => {
    expect(toMinor('150,000')).toBe(15000000)
    expect(toMinor('TZS 150 000')).toBe(15000000)
    expect(toMinor('150000.50')).toBe(15000050)
    expect(toMinor('-5,000')).toBe(-500000)
    expect(toMinor('  150000  ')).toBe(15000000)
  })
})

describe('money never renders negative zero', () => {
  // Was: IEEE-754 negative zero reached Intl, which printed "TZS -0" on a dashboard.
  it('formats a rounded-to-zero negative as plain zero', () => {
    expect(formatMoney(multiplyMinor(-1, 0.4))).toBe('TZS 0')
    expect(formatMoney(-49)).toBe('TZS 0')
    expect(Object.is(multiplyMinor(-1, 0.4), -0)).toBe(false)
  })
})

describe('money arithmetic guards its results, not only its inputs', () => {
  // Was: inputs were asserted, then a value isValidMinor() itself rejects was returned.
  it('throws rather than returning an inexact integer', () => {
    expect(() => multiplyMinor(1e15, 1e5)).toThrow(RangeError)
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('keeps allocation exact for realistic by_revenue weights', () => {
    // ~40 million TZS in senti per agent — a plausible weight set for 50 staff.
    const weights = Array.from({ length: 50 }, (_, i) => 4_000_000_000 + i * 137_000_000)
    const total = 987_654_321
    const shares = allocateMinor(total, weights)
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
    expect(shares.every(isValidMinor)).toBe(true)
  })
})

describe('CSV export reconciles', () => {
  // Was: the export used DISPLAY_DECIMALS (TZS: 0), so allocated rows no longer summed to
  // the exported total — finance opens a spreadsheet that does not add up to itself.
  it('exported rows sum to the exported total', () => {
    const total = 100000
    const rows = allocateMinor(total, [1, 1, 1]) // [33334, 33333, 33333]
    const exportedSum = rows.reduce((a, r) => a + Number(formatMoneyForExport(r)), 0)
    expect(exportedSum).toBeCloseTo(Number(formatMoneyForExport(total)), 10)
  })
})

describe('phone normalisation does not manufacture numbers out of junk', () => {
  // Was: any digit string starting "2550" had a digit removed and was re-parsed, so
  // "2550712345" became +255255712345 — a real Mbeya landline. That collides on the
  // leadPhoneIndex key (TODO.md §6.4) and reports a stranger's number as already owned by
  // a colleague: the duplicate lock firing in reverse.
  it('rejects a short 2550... string instead of inventing a landline', () => {
    expect(normalizePhone('2550712345')).toBeNull()
    expect(normalizePhone('2550000000')).toBeNull()
    expect(normalizePhone('25501')).toBeNull()
  })

  it('does not collide a real landline with a truncated entry', () => {
    expect(normalizePhone('0255712345')).toBe('+255255712345')
    expect(samePhone('0255712345', '2550712345')).toBe(false)
  })

  it('still strips a genuine trunk zero after the country code', () => {
    expect(normalizePhone('+2550712345678')).toBe('+255712345678')
    expect(normalizePhone('2550712345678')).toBe('+255712345678')
  })
})

describe('phone accepts international dialling prefixes', () => {
  // Was: "+255…" and Tanzania's own "000255…" worked, but "00255…" — what Kenya, Uganda,
  // Europe and most pasted contact exports use — returned null, so a lead arriving that
  // way simply could not be captured (P7).
  it.each([
    ['+255712345678'],
    ['00255712345678'],
    ['000255712345678'],
    ['011255712345678'],
    ['00 255 712 345 678'],
  ])('normalises %s', (input) => {
    expect(normalizePhone(input)).toBe('+255712345678')
  })

  it('does not mistake a local number for an IDD prefix', () => {
    expect(normalizePhone('0712345678')).toBe('+255712345678')
  })
})

describe('carrierHint has no unreachable entries and no silent gaps', () => {
  // Was: '77' appeared under both Tigo and Zantel, making the Zantel entry dead code that
  // object key order alone decided; and six valid mobile prefixes returned null, an
  // invisible under-count in airtime cost analysis.
  it('resolves a previously duplicated prefix deterministically', () => {
    expect(carrierHint('0771234567')).toBe('Tigo')
  })

  it('never silently drops a valid mobile number from the analysis', () => {
    for (const prefix of ['60', '63', '64', '66', '70', '72']) {
      const number = `0${prefix}1234567`
      if (normalizePhone(number) === null) continue // not a valid TZ mobile — fine
      expect(typeof carrierHint(number), `prefix ${prefix} vanished`).toBe('string')
    }
  })

  it('still names the carriers it knows', () => {
    expect(carrierHint('0754123456')).toBe('Vodacom')
    expect(carrierHint('0784123456')).toBe('Airtel')
  })

  it('returns null where the question does not apply', () => {
    expect(carrierHint('+254712345678')).toBeNull()
    expect(carrierHint('rubbish')).toBeNull()
    expect(carrierHint('0255712345')).toBeNull() // landline, not a mobile
  })
})
