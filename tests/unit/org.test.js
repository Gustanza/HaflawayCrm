import { describe, it, expect } from 'vitest'
import { ORG_ID_PATTERN, isValidOrgId, slugifyOrgId, nextSlugCandidate } from '../../src/domain/org.js'

describe('slugifyOrgId — every result must satisfy ORG_ID_PATTERN', () => {
  it('lowercases and hyphenates a normal company name', () => {
    expect(slugifyOrgId('Acme Events')).toBe('acme-events')
  })

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slugifyOrgId('  Neema & Baraka!! Weddings...  ')).toBe('neema-baraka-weddings')
  })

  it('strips diacritics rather than dropping the letters entirely', () => {
    expect(slugifyOrgId('Café Déjà Vu')).toBe('cafe-deja-vu')
  })

  it('clamps to 40 characters', () => {
    const long = 'A'.repeat(80)
    const result = slugifyOrgId(long)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(isValidOrgId(result)).toBe(true)
  })

  it('pads a name shorter than 2 valid characters instead of producing an invalid id', () => {
    expect(isValidOrgId(slugifyOrgId('A'))).toBe(true)
    expect(isValidOrgId(slugifyOrgId(''))).toBe(true)
  })

  it('pads a name that is entirely non-ASCII punctuation once stripped', () => {
    // Emoji and CJK punctuation have no ASCII letters to fall back on.
    expect(isValidOrgId(slugifyOrgId('🎉🎉🎉'))).toBe(true)
    expect(isValidOrgId(slugifyOrgId('…'))).toBe(true)
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugifyOrgId('-Acme-')).toBe('acme')
  })

  it('every result matches ORG_ID_PATTERN, across a spread of inputs', () => {
    const names = ['Acme', 'Neema & Baraka', '株式会社', '  ', 'A', 'x'.repeat(100), 'Test-Co_2026']
    for (const name of names) {
      expect(ORG_ID_PATTERN.test(slugifyOrgId(name)), `failed on: ${name}`).toBe(true)
    }
  })
})

describe('nextSlugCandidate — deterministic suffixing, then a safe fallback', () => {
  it('returns the base unchanged on the first attempt', () => {
    expect(nextSlugCandidate('acme', 1)).toBe('acme')
  })

  it('suffixes deterministically for the next several attempts', () => {
    expect(nextSlugCandidate('acme', 2)).toBe('acme-2')
    expect(nextSlugCandidate('acme', 3)).toBe('acme-3')
  })

  it('every candidate stays within the 40-char ceiling even for a maxed-out base', () => {
    const base = 'a'.repeat(40)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(nextSlugCandidate(base, attempt).length).toBeLessThanOrEqual(40)
    }
  })

  it('falls back to a random suffix past the deterministic ceiling, and never gets stuck', () => {
    const seen = new Set()
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const candidate = nextSlugCandidate('acme', attempt, { maxDeterministic: 20 })
      expect(ORG_ID_PATTERN.test(candidate), `invalid candidate: ${candidate}`).toBe(true)
      seen.add(candidate)
    }
    // Not a strict guarantee with randomness involved, but collapsing to one value would
    // mean the fallback is broken.
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('isValidOrgId', () => {
  it('accepts the well-formed shapes', () => {
    for (const id of ['ab', 'acme', 'acme-events', 'a'.repeat(40)]) {
      expect(isValidOrgId(id)).toBe(true)
    }
  })

  it('rejects underscores — orgId is the prefix of the leadPhoneIndex key', () => {
    expect(isValidOrgId('acme_events')).toBe(false)
  })

  it('rejects uppercase, too-short, too-long and non-string input', () => {
    expect(isValidOrgId('Acme')).toBe(false)
    expect(isValidOrgId('a')).toBe(false)
    expect(isValidOrgId('a'.repeat(41))).toBe(false)
    expect(isValidOrgId(null)).toBe(false)
    expect(isValidOrgId(undefined)).toBe(false)
  })
})
