import { describe, it, expect } from 'vitest'
import {
  normalizePhone,
  isValidPhone,
  formatPhone,
  formatAsYouType,
  toTelLink,
  toWhatsAppLink,
  carrierHint,
  samePhone,
} from '../../src/domain/phone.js'

const E164 = '+255712345678'

describe('normalizePhone — every spelling of one number must collapse to one key', () => {
  it('accepts the shapes Tanzanian users actually type', () => {
    const variants = [
      '0712345678',
      '0712 345 678',
      '0712-345-678',
      '+255712345678',
      '+255 712 345 678',
      '255712345678',
      '712345678',
      '  0712345678  ',
      '(0712) 345678',
      '0712.345.678',
    ]
    for (const v of variants) {
      expect(normalizePhone(v), `failed on: ${v}`).toBe(E164)
    }
  })

  it('strips a trunk zero left in after the country code', () => {
    // The classic copy-paste error: country code AND the local leading zero.
    expect(normalizePhone('+2550712345678')).toBe(E164)
    expect(normalizePhone('2550712345678')).toBe(E164)
  })

  it('is idempotent — normalising an already-normal number changes nothing', () => {
    expect(normalizePhone(normalizePhone('0712345678'))).toBe(E164)
  })

  it('handles a foreign number given in full international form', () => {
    expect(normalizePhone('+254712345678')).toBe('+254712345678')
  })

  it('returns null for anything invalid, so callers must reject rather than store junk', () => {
    const bad = [
      null,
      undefined,
      '',
      '   ',
      'abc',
      '123',
      '07123',
      '07123456789012345',
      '0000000000',
      '+255',
    ]
    for (const v of bad) {
      expect(normalizePhone(v), `should reject: ${JSON.stringify(v)}`).toBeNull()
    }
  })

  it('accepts numbers as a Number type without losing the leading zero problem', () => {
    // 712345678 as a number has no leading zero — still resolvable via the TZ region default.
    expect(normalizePhone(712345678)).toBe(E164)
  })
})

describe('isValidPhone', () => {
  it('mirrors normalizePhone', () => {
    expect(isValidPhone('0712345678')).toBe(true)
    expect(isValidPhone('123')).toBe(false)
    expect(isValidPhone(null)).toBe(false)
  })
})

describe('samePhone — the dedupe question', () => {
  it('matches across formats', () => {
    expect(samePhone('0712345678', '+255 712 345 678')).toBe(true)
    expect(samePhone('255712345678', '0712-345-678')).toBe(true)
  })

  it('does not match different numbers', () => {
    expect(samePhone('0712345678', '0713345678')).toBe(false)
  })

  it('never reports two invalid numbers as the same', () => {
    // Otherwise every junk entry would collide on one index key.
    expect(samePhone('abc', 'def')).toBe(false)
    expect(samePhone(null, null)).toBe(false)
    expect(samePhone('', '')).toBe(false)
  })
})

describe('formatPhone', () => {
  it('shows local numbers in national form', () => {
    expect(formatPhone('+255712345678')).toBe('0712 345 678')
  })

  it('shows foreign numbers in international form', () => {
    expect(formatPhone('+254712345678')).toBe('+254 712 345678')
  })

  it('falls back to the raw input rather than blanking the field', () => {
    expect(formatPhone('not a number')).toBe('not a number')
    expect(formatPhone(null)).toBe('')
  })
})

describe('formatAsYouType', () => {
  it('formats progressively without throwing on partial input', () => {
    expect(formatAsYouType('071')).toBeTypeOf('string')
    expect(formatAsYouType('0712345678')).toBe('0712 345 678')
    expect(formatAsYouType('')).toBe('')
    expect(formatAsYouType(null)).toBe('')
  })
})

describe('links', () => {
  it('builds a tel: link in E.164', () => {
    expect(toTelLink('0712345678')).toBe('tel:+255712345678')
    expect(toTelLink('rubbish')).toBeNull()
  })

  it('builds a wa.me link with digits only and no plus', () => {
    expect(toWhatsAppLink('0712345678')).toBe('https://wa.me/255712345678')
  })

  it('url-encodes the prefilled message', () => {
    expect(toWhatsAppLink('0712345678', 'Habari! Karibu Haflaway')).toBe(
      'https://wa.me/255712345678?text=Habari!%20Karibu%20Haflaway',
    )
  })

  it('returns null for an unusable number rather than a broken link', () => {
    expect(toWhatsAppLink('123')).toBeNull()
  })
})

describe('carrierHint', () => {
  it('identifies common Tanzanian prefixes', () => {
    expect(carrierHint('0754123456')).toBe('Vodacom')
    expect(carrierHint('0784123456')).toBe('Airtel')
    expect(carrierHint('0712345678')).toBe('Tigo')
  })

  it('returns null for foreign or unknown numbers', () => {
    expect(carrierHint('+254712345678')).toBeNull()
    expect(carrierHint('rubbish')).toBeNull()
  })
})
