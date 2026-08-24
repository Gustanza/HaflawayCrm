import { describe, it, expect } from 'vitest'
import {
  toMinor,
  toMajor,
  addMinor,
  subtractMinor,
  multiplyMinor,
  divideMinor,
  percentOfMinor,
  splitMinor,
  allocateMinor,
  formatMoney,
  formatMoneyForExport,
  formatPercent,
  isValidMinor,
} from '../../src/domain/money.js'

describe('toMinor', () => {
  it('converts plain numbers', () => {
    expect(toMinor(150000)).toBe(15000000)
    expect(toMinor(0)).toBe(0)
  })

  it('survives float representation error', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE754 — must still be 1999.
    expect(toMinor(19.99)).toBe(1999)
    expect(toMinor(0.1 + 0.2)).toBe(30)
  })

  it('reads the messy strings humans actually type', () => {
    expect(toMinor('150,000')).toBe(15000000)
    expect(toMinor('TZS 150 000')).toBe(15000000)
    expect(toMinor('  150000  ')).toBe(15000000)
    expect(toMinor('150000.50')).toBe(15000050)
  })

  it('handles negatives, for corrective entries', () => {
    expect(toMinor(-5000)).toBe(-500000)
    expect(toMinor('-5,000')).toBe(-500000)
  })

  it('returns null rather than 0 for unreadable input', () => {
    expect(toMinor(null)).toBeNull()
    expect(toMinor(undefined)).toBeNull()
    expect(toMinor('')).toBeNull()
    expect(toMinor('abc')).toBeNull()
    expect(toMinor('1.2.3')).toBeNull()
    expect(toMinor(Infinity)).toBeNull()
    expect(toMinor(NaN)).toBeNull()
    expect(toMinor({})).toBeNull()
  })

  it('refuses amounts that exceed exact integer range', () => {
    expect(toMinor(Number.MAX_SAFE_INTEGER)).toBeNull()
  })
})

describe('toMajor', () => {
  it('round-trips', () => {
    expect(toMajor(toMinor(150000))).toBe(150000)
  })

  it('passes null through', () => {
    expect(toMajor(null)).toBeNull()
  })

  it('throws on a non-integer amount, which would mean corrupt stored data', () => {
    expect(() => toMajor(150.5)).toThrow(TypeError)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addMinor(1000, 2000, 3000)).toBe(6000)
    expect(addMinor()).toBe(0)
    expect(subtractMinor(5000, 1500)).toBe(3500)
  })

  it('multiplies with half-up rounding', () => {
    expect(multiplyMinor(1000, 3)).toBe(3000)
    expect(multiplyMinor(333, 0.5)).toBe(167) // 166.5 → 167
  })

  it('rejects non-integer minor amounts', () => {
    expect(() => addMinor(10.5, 1)).toThrow(TypeError)
    expect(() => multiplyMinor(10.5, 2)).toThrow(TypeError)
  })

  it('returns null on divide-by-zero instead of Infinity — the §8.5 rule', () => {
    expect(divideMinor(15000000, 0)).toBeNull()
    expect(divideMinor(15000000, 3)).toBe(5000000)
  })

  it('computes percentages', () => {
    expect(percentOfMinor(15000000, 10)).toBe(1500000)
    expect(percentOfMinor(333, 33.3)).toBe(111)
  })
})

describe('splitMinor — must not lose or invent units', () => {
  it('splits evenly when it can', () => {
    expect(splitMinor(900, 3)).toEqual([300, 300, 300])
  })

  it('distributes the remainder to the earliest shares', () => {
    expect(splitMinor(100, 3)).toEqual([34, 33, 33])
    expect(splitMinor(10, 4)).toEqual([3, 3, 2, 2])
  })

  it('always sums back to the original', () => {
    for (const [amount, parts] of [[100, 3], [1, 7], [999983, 50], [0, 5]]) {
      expect(splitMinor(amount, parts).reduce((a, b) => a + b, 0)).toBe(amount)
    }
  })

  it('handles negative amounts (corrections) without losing units', () => {
    const parts = splitMinor(-100, 3)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-100)
  })

  it('rejects invalid part counts', () => {
    expect(() => splitMinor(100, 0)).toThrow(RangeError)
    expect(() => splitMinor(100, -1)).toThrow(RangeError)
    expect(() => splitMinor(100, 2.5)).toThrow(RangeError)
  })
})

describe('allocateMinor — pro-rata overhead, §9', () => {
  it('allocates by weight', () => {
    expect(allocateMinor(1000, [1, 1, 2])).toEqual([250, 250, 500])
  })

  it('sums back exactly even with awkward weights', () => {
    const out = allocateMinor(1000, [1, 1, 1])
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(out).toEqual([334, 333, 333])
  })

  it('gives leftover units to the largest fractional remainder', () => {
    // 10 across [1,2,3]: raw 1.67 / 3.33 / 5.0 → floors 1/3/5, one unit left to the .67
    expect(allocateMinor(10, [1, 2, 3])).toEqual([2, 3, 5])
  })

  it('falls back to an equal split when every weight is zero, never dropping the money', () => {
    const out = allocateMinor(100, [0, 0, 0])
    expect(out.reduce((a, b) => a + b, 0)).toBe(100)
    expect(out).toEqual([34, 33, 33])
  })

  it('returns an empty array for no recipients', () => {
    expect(allocateMinor(100, [])).toEqual([])
  })

  it('rejects negative weights', () => {
    expect(() => allocateMinor(100, [1, -1])).toThrow(RangeError)
  })

  it('is exact across a realistic 50-staff overhead split', () => {
    const weights = Array.from({ length: 50 }, (_, i) => i + 1)
    const out = allocateMinor(123456789, weights)
    expect(out.reduce((a, b) => a + b, 0)).toBe(123456789)
    expect(out).toHaveLength(50)
  })
})

describe('formatting', () => {
  it('formats TZS with no decimals', () => {
    expect(formatMoney(15000000)).toBe('TZS 150,000')
  })

  it('renders an em dash for null — the §8.5 zero/unknown rule', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Infinity)).toBe('—')
  })

  it('compacts large numbers for dashboard tiles', () => {
    expect(formatMoney(120000000, 'TZS', { compact: true })).toBe('TZS 1.2M')
  })

  it('can omit the currency code', () => {
    expect(formatMoney(15000000, 'TZS', { showCurrency: false })).toBe('150,000')
  })

  it('shows cents for USD but not TZS', () => {
    expect(formatMoney(199900, 'USD')).toBe('USD 1,999.00')
    expect(formatMoney(199900, 'TZS')).toBe('TZS 1,999')
  })

  it('exports at full minor-unit precision so rows reconcile', () => {
    // Display may round TZS to whole shillings; an export may not, or a set of allocated
    // rows stops summing to its own total once it reaches a spreadsheet.
    expect(formatMoneyForExport(15000000)).toBe('150000.00')
    expect(formatMoneyForExport(199900, 'USD')).toBe('1999.00')
    expect(formatMoneyForExport(null)).toBe('')
  })

  it('formats percentages', () => {
    expect(formatPercent(0.4237)).toBe('42.4%')
    expect(formatPercent(0.4237, 0)).toBe('42%')
  })
})

describe('isValidMinor', () => {
  it('accepts integers only', () => {
    expect(isValidMinor(100)).toBe(true)
    expect(isValidMinor(0)).toBe(true)
    expect(isValidMinor(-100)).toBe(true)
    expect(isValidMinor(100.5)).toBe(false)
    expect(isValidMinor(NaN)).toBe(false)
    expect(isValidMinor('100')).toBe(false)
    expect(isValidMinor(Number.MAX_SAFE_INTEGER + 2)).toBe(false)
  })
})
