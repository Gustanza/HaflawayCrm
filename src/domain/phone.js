/**
 * Phone normalisation — load-bearing.
 *
 * `phoneNormalized` is the primary key of `leadPhoneIndex` (TODO.md §6.4). If two spellings
 * of the same number normalise differently, the duplicate lock silently fails and two agents
 * end up working the same bride — the commission fight this system exists to prevent.
 *
 * Tanzanian numbers arrive in every shape: 0712 345 678, +255712345678, 255712345678,
 * 712345678, 0712-345-678, and occasionally with a stray leading "+255 0".
 */

import { parsePhoneNumberFromString, isValidPhoneNumber, AsYouType } from 'libphonenumber-js'

export const DEFAULT_REGION = 'TZ'
export const DEFAULT_CALLING_CODE = '255'

/**
 * Normalise to E.164 ("+255712345678"). Returns null when the input cannot be understood
 * as a valid number — callers MUST treat null as "reject this input", never as "store as-is".
 */
export function normalizePhone(input, region = DEFAULT_REGION) {
  if (input == null) return null
  const raw = String(input).trim()
  if (raw === '') return null

  // Keep digits and a single leading plus; drop spaces, dashes, brackets, dots.
  const hasPlus = raw.startsWith('+')
  let digits = raw.replace(/\D/g, '')
  if (digits === '') return null

  let international = hasPlus

  // An international dialling prefix instead of "+". "000" is Tanzania's own IDD; "00" is
  // what Kenya, Uganda and most of Europe use, and it is what you get from a pasted contact
  // export. Rejecting "00255…" meant a lead simply could not be captured (P7).
  //
  // NATIONAL NUMBER WINS. Stripping unconditionally broke other regions badly: with
  // region='KE' it ate the whole Safaricom 0110–0117 range, and with region='ZA' it ate the
  // 011 Johannesburg area code — turning valid local numbers into nulls. So we only treat a
  // leading 00/011/000 as an IDD prefix when the string is NOT already a valid national
  // number in the caller's region.
  // Longest prefix first, or "000255…" would lose only "00" and leave a bogus leading zero.
  if (!international) {
    const asNational = parsePhoneNumberFromString(digits, region)
    if (!asNational || !asNational.isValid()) {
      for (const idd of ['000', '011', '00']) {
        if (digits.startsWith(idd) && digits.length > idd.length + 6) {
          digits = digits.slice(idd.length)
          international = true
          break
        }
      }
    }
  }

  // "+255 0712 345 678" — country code AND the national trunk zero, the classic paste error.
  //
  // The length check is load-bearing. Without it, ANY digit string beginning "2550" had a
  // digit removed and was then re-parsed, which happily manufactured a valid-looking number
  // out of junk: "2550712345" became +255255712345 — a real Mbeya landline. That collides
  // on the leadPhoneIndex key (§6.4) and tells an agent a stranger's number is already
  // owned by a colleague: the dedupe lock firing in reverse.
  //
  // 13 = 255 (3) + trunk zero (1) + 9 national digits.
  const TRUNK_ZERO_LENGTH = DEFAULT_CALLING_CODE.length + 1 + 9
  if (digits.length === TRUNK_ZERO_LENGTH && digits.startsWith(DEFAULT_CALLING_CODE + '0')) {
    digits = DEFAULT_CALLING_CODE + digits.slice(DEFAULT_CALLING_CODE.length + 1)
  }

  // Rebuild a candidate the library can parse.
  let candidate
  if (international) {
    candidate = '+' + digits
  } else if (digits.startsWith(DEFAULT_CALLING_CODE) && digits.length >= 12) {
    candidate = '+' + digits
  } else {
    candidate = digits // let the region default supply the country code
  }

  const parsed = parsePhoneNumberFromString(candidate, region)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number // E.164
}

/** True when the input normalises to a valid number. */
export function isValidPhone(input, region = DEFAULT_REGION) {
  return normalizePhone(input, region) !== null
}

/**
 * Human display: "0712 345 678" for local numbers, "+254 712 345 678" for foreign ones.
 * Falls back to the raw input rather than showing an empty field.
 */
export function formatPhone(input, region = DEFAULT_REGION) {
  const e164 = normalizePhone(input, region)
  if (!e164) return input == null ? '' : String(input)

  const parsed = parsePhoneNumberFromString(e164)
  if (!parsed) return e164
  return parsed.country === region ? parsed.formatNational() : parsed.formatInternational()
}

/** Progressive formatting while the user types, for the quick-add form (TODO.md P7). */
export function formatAsYouType(input, region = DEFAULT_REGION) {
  if (input == null) return ''
  return new AsYouType(region).input(String(input))
}

/**
 * The tel: href for one-tap dialling. Always E.164 so it works from any network.
 */
export function toTelLink(input, region = DEFAULT_REGION) {
  const e164 = normalizePhone(input, region)
  return e164 ? `tel:${e164}` : null
}

/**
 * The wa.me deep link — our Phase-1 WhatsApp integration (TODO.md §14).
 * wa.me wants digits only, no plus sign.
 */
export function toWhatsAppLink(input, message = '', region = DEFAULT_REGION) {
  const e164 = normalizePhone(input, region)
  if (!e164) return null
  const digits = e164.replace(/^\+/, '')
  const q = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${q}`
}

/**
 * Carrier hint, useful for airtime cost analysis and for spotting typo'd prefixes.
 * Prefixes are the widely-used Tanzanian allocations; treat the result as a hint, not truth,
 * because number portability means the prefix no longer guarantees the network.
 */
/**
 * Keyed by prefix, not by carrier. The carrier-keyed shape allowed the same prefix to
 * appear under two carriers ('77' was listed under both Tigo and Zantel) and silently
 * resolved by object key order, making one entry unreachable dead code. Keying by prefix
 * makes a duplicate a visible conflict at the point of editing.
 */
const TZ_CARRIER_BY_PREFIX = {
  61: 'Halotel',
  62: 'Halotel',
  65: 'Tigo',
  67: 'Tigo',
  68: 'Airtel',
  69: 'Airtel',
  71: 'Tigo',
  73: 'TTCL',
  74: 'Vodacom',
  75: 'Vodacom',
  76: 'Vodacom',
  77: 'Tigo',
  78: 'Airtel',
  79: 'Airtel',
}

/**
 * Best-effort network guess, for airtime cost analysis.
 *
 * Returns:
 *   - a carrier name for a mapped Tanzanian prefix
 *   - 'unknown' for a valid TZ number whose prefix is not in the table — a detectable gap,
 *     rather than the silent under-count that returning null produced
 *   - null for a foreign or unparseable number, where the question does not apply
 *
 * Number portability means the prefix no longer guarantees the network. Treat every result
 * as a hint; never bill anyone on the strength of it.
 */
export function carrierHint(input, region = DEFAULT_REGION) {
  const e164 = normalizePhone(input, region)
  if (!e164 || !e164.startsWith('+' + DEFAULT_CALLING_CODE)) return null
  const national = e164.slice(1 + DEFAULT_CALLING_CODE.length)
  const prefix = national.slice(0, 2)
  // Landlines and short codes are not mobile at all — no carrier question to answer.
  if (!/^6|^7/.test(prefix)) return null
  return TZ_CARRIER_BY_PREFIX[prefix] ?? 'unknown'
}

/**
 * Compare two numbers for identity. This is what the dedupe check asks.
 * Two inputs match when they normalise to the same E.164 string.
 */
export function samePhone(a, b, region = DEFAULT_REGION) {
  const na = normalizePhone(a, region)
  const nb = normalizePhone(b, region)
  return na !== null && na === nb
}

/** Re-exported so callers can check a number against a non-default region without a second import. */
export { isValidPhoneNumber }
