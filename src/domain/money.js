/**
 * Money — integer minor units only.
 *
 * TODO.md §6.1: every stored amount is an integer in minor units plus a currency code.
 * Floats are banned: 0.1 + 0.2 !== 0.3, and a CRM that loses shillings loses trust.
 *
 * TZS in practice has no circulating subunit, but we still store minor units (senti, 1/100)
 * so that percentage maths (discounts, commission, pro-rata overhead allocation) has
 * somewhere to round to instead of silently truncating whole shillings.
 *
 * ROUNDING: half away from zero, ALWAYS. Math.round() rounds half toward +Infinity, so
 * +166.5 becomes 167 while -166.5 becomes -166. Under P4 a correction is a new NEGATIVE
 * entry, so asymmetric rounding leaves a stranded minor unit in the ledger every time a
 * figure is reversed — and the ledger is the thing that has to survive an argument.
 *
 * ERROR CONVENTION: a bad VALUE (unreadable amount, divide by zero) returns null. A broken
 * CONTRACT (non-integer minor units, a negative weight, a non-numeric rate) throws, because
 * it means the caller has a bug that must not be papered over with a default of zero.
 */

export const DEFAULT_CURRENCY = 'TZS'

/** Minor units per major unit, by currency. */
const MINOR_PER_MAJOR = { TZS: 100, KES: 100, UGX: 100, USD: 100, EUR: 100 }

/** How many decimals we *display*. TZS is shown whole; USD shows cents. */
const DISPLAY_DECIMALS = { TZS: 0, KES: 0, UGX: 0, USD: 2, EUR: 2 }

export function minorPerMajor(currency = DEFAULT_CURRENCY) {
  return MINOR_PER_MAJOR[currency] ?? 100
}

/** True for a safe, storable amount: an integer within Number's exact range. */
export function isValidMinor(amountMinor) {
  return Number.isInteger(amountMinor) && Number.isSafeInteger(amountMinor)
}

function assertMinor(amountMinor, label = 'amount') {
  if (!isValidMinor(amountMinor)) {
    throw new TypeError(`${label} must be a safe integer in minor units, received: ${amountMinor}`)
  }
}

/**
 * Major units (what a human types: 150000) → minor units (15000000).
 * Accepts numbers and the messy strings people really type or export:
 * "150,000", "TZS 150 000", "150000.50", "(1500)".
 *
 * Returns null for anything it cannot read UNAMBIGUOUSLY — callers must handle null and
 * never coerce it to 0.
 *
 * This deliberately VALIDATES rather than sanitises. The previous approach — delete every
 * character that is not a digit, dot or minus, then hope Number() agrees — turned "(1500)"
 * into +1500, silently flipping the sign of an accounting negative, and turned "1e5" into
 * 1500 and "20%" into 2000. Phase 2 imports historic expenses from CSV, where parenthesised
 * negatives are standard, so a sign flip here is a real corruption of the ledger.
 */
export function toMinor(major, currency = DEFAULT_CURRENCY) {
  if (major == null || major === '') return null

  let n
  if (typeof major === 'number') {
    n = major
  } else if (typeof major === 'string') {
    let s = major.trim()
    if (s === '') return null

    // Accounting negative: "(1500)" means -1500.
    //
    // A sign INSIDE the brackets is ambiguous — "(-1500)" could mean -1500 or +1500 — and
    // the first version negated an already-negative value, turning it into +150000. That
    // is the very ledger-corruption class this parser was rewritten to eliminate, so
    // reject it rather than guess.
    let negate = false
    if (/^\(.*\)$/.test(s)) {
      negate = true
      s = s.slice(1, -1).trim()
      if (/^[+-]/.test(s)) return null
    }

    // A leading or trailing currency code/symbol is fine; anything else alphabetic is not.
    s = s.replace(/^(?:TZS|KES|UGX|USD|EUR|Tsh|TSh|[$€£])\s*/i, '')
    s = s.replace(/\s*(?:TZS|KES|UGX|USD|EUR|Tsh|TSh|\/=)$/i, '')

    // Thousands separators: spaces (incl. non-breaking), commas, apostrophes.
    s = s.replace(/[\s,'  ]/g, '')

    // Whatever is left must be an unambiguous decimal number. This rejects "1e5", "20%",
    // "1.2.3", "1 2 x 3" and any stray letter, rather than guessing at them.
    //
    // It DOES accept an explicit leading "+" (common in exports), a bare ".5", and a
    // trailing "5." — all unambiguous, and all of which an earlier revision rejected,
    // silently refusing amounts a user had typed correctly.
    if (!/^[+-]?(\d+(\.\d+)?|\.\d+|\d+\.)$/.test(s)) return null

    n = Number(s)
    if (negate) n = -n
  } else {
    return null
  }

  if (!Number.isFinite(n)) return null

  // Round away from zero so that reversing an amount reverses it exactly, and so that
  // float representation error does not bite: 19.99 * 100 is 1998.9999999999998.
  const scaled = roundMinor(n * minorPerMajor(currency))
  return Number.isSafeInteger(scaled) ? scaled : null
}

/** Minor units → major units as a Number. For display and charts only, never for storage. */
export function toMajor(amountMinor, currency = DEFAULT_CURRENCY) {
  if (amountMinor == null) return null
  assertMinor(amountMinor)
  return amountMinor / minorPerMajor(currency)
}

/* ---------------------------------------------------------------------------
 * Arithmetic. All inputs and outputs are minor units.
 * ------------------------------------------------------------------------- */

/** Half away from zero, and never returns -0 (Intl would print it as "TZS -0"). */
function roundMinor(x) {
  return (x < 0 ? -Math.round(-x) : Math.round(x)) + 0
}

/** Guard the RESULT too: a computation that leaves the exact-integer range is corrupt data. */
function assertResult(value) {
  if (!isValidMinor(value)) {
    throw new RangeError(`money arithmetic overflowed the exact integer range: ${value}`)
  }
  return value
}

export function addMinor(...amounts) {
  return assertResult(
    amounts.reduce((sum, a) => {
      assertMinor(a)
      return sum + a
    }, 0),
  )
}

export function subtractMinor(a, b) {
  assertMinor(a, 'minuend')
  assertMinor(b, 'subtrahend')
  return assertResult(a - b)
}

/** Multiply by a quantity or rate, rounding half away from zero. */
export function multiplyMinor(amountMinor, factor) {
  assertMinor(amountMinor)
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    throw new TypeError(`factor must be a finite number, received: ${factor}`)
  }
  return assertResult(roundMinor(amountMinor * factor))
}

/**
 * Divide, rounding half-up. Returns null on divide-by-zero rather than Infinity —
 * see TODO.md §8.5: a zero denominator must render as "—", never as ∞.
 */
export function divideMinor(amountMinor, divisor) {
  assertMinor(amountMinor)
  if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor === 0) return null
  return assertResult(roundMinor(amountMinor / divisor))
}

export function percentOfMinor(amountMinor, percent) {
  // Validate before dividing: `null / 100` is 0, so an empty commission field would sail
  // past multiplyMinor's guard and silently book a 0% rate as if it were deliberate.
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    throw new TypeError(`percent must be a finite number, received: ${percent}`)
  }
  return multiplyMinor(amountMinor, percent / 100)
}

/**
 * Split an amount into `parts` shares that sum EXACTLY back to the original.
 * The remainder is distributed one minor unit at a time to the earliest shares,
 * so 100 split 3 ways is [34, 33, 33] — never [33, 33, 33] losing a unit.
 * Used for equal overhead allocation (TODO.md §9).
 */
export function splitMinor(amountMinor, parts) {
  assertMinor(amountMinor)
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`parts must be a positive integer, received: ${parts}`)
  }
  const base = Math.trunc(amountMinor / parts)
  let remainder = amountMinor - base * parts
  const step = remainder >= 0 ? 1 : -1
  return Array.from({ length: parts }, () => {
    if (remainder !== 0) {
      remainder -= step
      return base + step
    }
    return base
  })
}

/**
 * Allocate an amount pro-rata across `weights`, summing exactly back to the original.
 * Used for `by_leads` and `by_revenue` overhead allocation (TODO.md §9).
 * All-zero or empty weights fall back to an equal split, so overhead is never silently dropped.
 */
export function allocateMinor(amountMinor, weights) {
  assertMinor(amountMinor)
  if (!Array.isArray(weights) || weights.length === 0) return []
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('weights must all be finite and non-negative')
  }

  const total = weights.reduce((s, w) => s + w, 0)
  if (total === 0) return splitMinor(amountMinor, weights.length)

  const raw = weights.map((w) => (amountMinor * w) / total)
  const floored = raw.map((r) => Math.floor(r))
  let remainder = amountMinor - floored.reduce((s, f) => s + f, 0)

  // Hand the leftover units to the largest fractional parts (largest-remainder method).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const out = [...floored]

  // The remainder can be NEGATIVE when `amountMinor * w` exceeds 2^53 and the floors
  // overshoot. The old `remainder > 0` loop simply never ran in that case and returned
  // shares summing to MORE than the input — money created from nothing. Unreachable with
  // real TZS figures (it needs ~10 trillion shillings), but this is a ledger primitive.
  const step = remainder >= 0 ? 1 : -1
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    out[order[k].i] += step
    remainder -= step
  }

  // The whole contract of this function is that the shares sum to the input.
  const sum = out.reduce((a, b) => a + b, 0)
  if (sum !== amountMinor) {
    throw new RangeError(`allocateMinor lost precision: shares sum to ${sum}, expected ${amountMinor}`)
  }
  return out
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

/**
 * "TZS 150,000". Pass `compact` for dashboard tiles: "TZS 1.2M".
 * Null and undefined render as an em dash, matching the zero-denominator rule in §8.5.
 */
export function formatMoney(amountMinor, currency = DEFAULT_CURRENCY, options = {}) {
  const { compact = false, showCurrency = true, locale = 'en-TZ' } = options
  if (amountMinor == null) return '—'
  assertMinor(amountMinor)

  const decimals = DISPLAY_DECIMALS[currency] ?? 2
  const maxFractionDigits = compact ? 1 : decimals

  let value = amountMinor / minorPerMajor(currency)

  // Any amount that ROUNDS to zero at display precision must lose its sign. TZS displays
  // whole shillings, so -49 senti would otherwise reach Intl as -0.49, round to -0, and
  // print as "TZS -0" on a dashboard. This covers IEEE-754 negative zero too.
  if (Math.round(value * 10 ** maxFractionDigits) === 0) value = 0

  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: maxFractionDigits,
    ...(compact ? { notation: 'compact', compactDisplay: 'short' } : {}),
  })

  return showCurrency ? `${currency} ${nf.format(value)}` : nf.format(value)
}

/**
 * Bare number for CSV export — major units, dot decimal, no grouping, no symbol.
 *
 * Uses FULL minor-unit precision, not DISPLAY_DECIMALS. Display may round TZS to whole
 * shillings; an export may not. allocateMinor deliberately distributes odd senti so the
 * shares sum exactly to the total, and rounding them away in the file means finance opens
 * a spreadsheet whose rows do not add up to its own total (TODO.md §12 screen 18).
 */
export function formatMoneyForExport(amountMinor, currency = DEFAULT_CURRENCY) {
  if (amountMinor == null) return ''
  assertMinor(amountMinor)
  const decimals = Math.round(Math.log10(minorPerMajor(currency)))
  return (amountMinor / minorPerMajor(currency)).toFixed(decimals)
}

/** Percentage display with the same em-dash rule for undefined ratios. */
export function formatPercent(ratio, decimals = 1) {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(decimals)}%`
}
