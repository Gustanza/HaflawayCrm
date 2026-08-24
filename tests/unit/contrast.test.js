/**
 * WCAG contrast of the design tokens.
 *
 * This exists because a comment in `style.css` once claimed `ring-slate-400` was 3.6:1
 * when it is 2.63:1 — the wrong figure was written next to the wrong colour and the
 * input border shipped failing SC 1.4.11 twice in a row. A comment cannot be trusted to
 * carry a computed value; a test can.
 *
 * §13: the deployment device is a low-end Android phone held outdoors in sunlight.
 * §16 Definition of Done requires the contrast pass.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/* --------------------------------------------------------------- colour maths */

/** oklch → linear sRGB → relative luminance, per WCAG 2.x. */
function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function relativeLuminance([r, g, b]) {
  const clamp = (v) => Math.min(1, Math.max(0, v))
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b)
}

function contrast(a, b) {
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y)
  return (hi + 0.05) / (lo + 0.05)
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const hexToLinearRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255))
}

/* ------------------------------------------------------- the palette we rely on */

const WHITE = hexToLinearRgb('#ffffff')
// Tailwind v4 defaults, the values the build actually resolves.
const SLATE = {
  300: hexToLinearRgb('#cad5e2'),
  400: hexToLinearRgb('#90a1b9'),
  500: hexToLinearRgb('#62748e'),
  600: hexToLinearRgb('#45556c'),
}

describe('the slate palette behaves as documented', () => {
  it('places slate-500 above the 3:1 non-text threshold and slate-400 below it', () => {
    // The whole reason the input border was wrong twice.
    expect(contrast(SLATE[300], WHITE)).toBeLessThan(3)
    expect(contrast(SLATE[400], WHITE)).toBeLessThan(3)
    expect(contrast(SLATE[500], WHITE)).toBeGreaterThanOrEqual(3)
  })

  it('places slate-500 above the 4.5:1 text threshold', () => {
    expect(contrast(SLATE[500], WHITE)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('style.css uses a compliant input boundary', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')
  const fieldInput = css.match(/\.field-input\s*\{[\s\S]*?\}/)?.[0] ?? ''

  it('rings the input with at least slate-500', () => {
    expect(fieldInput, '.field-input not found in style.css').not.toBe('')
    // SC 1.4.11: the boundary of a form control needs 3:1. slate-300 and slate-400 fail.
    expect(fieldInput).not.toMatch(/ring-slate-(50|100|200|300|400)\b/)
    expect(fieldInput).toMatch(/ring-slate-[5-9]00\b/)
  })

  it('uses a placeholder colour that clears 4.5:1', () => {
    expect(fieldInput).not.toMatch(/placeholder:text-slate-(300|400)\b/)
    expect(fieldInput).toMatch(/placeholder:text-slate-[5-9]00\b/)
  })
})

describe('urgency bands are readable as TEXT on white', () => {
  // TODO.md P2 makes these the product's signature affordance, and §13 puts the device
  // outdoors. Colour is never the only signal — every band renders with its day count —
  // but the colour still has to be legible.
  const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

  const bands = ['critical', 'high', 'medium', 'low'].map((name) => {
    const match = css.match(new RegExp(`--color-urgent-${name}:\\s*oklch\\(([^)]+)\\)`))
    if (!match) throw new Error(`--color-urgent-${name} not found`)
    const [L, C, h] = match[1].trim().split(/\s+/).map(Number)
    return { name, rgb: oklchToLinearRgb(L, C, h) }
  })

  it.each(bands)('$name clears 4.5:1 on white', ({ rgb }) => {
    expect(contrast(rgb, WHITE)).toBeGreaterThanOrEqual(4.5)
  })

  it('defines all four bands', () => {
    expect(bands).toHaveLength(4)
  })
})

describe('the brand colour is usable as a button background', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

  it('gives brand-600 at least 4.5:1 against white text', () => {
    const match = css.match(/--color-brand-600:\s*oklch\(([^)]+)\)/)
    expect(match, '--color-brand-600 not found').not.toBeNull()
    const [L, C, h] = match[1].trim().split(/\s+/).map(Number)
    expect(contrast(oklchToLinearRgb(L, C, h), WHITE)).toBeGreaterThanOrEqual(4.5)
  })
})
