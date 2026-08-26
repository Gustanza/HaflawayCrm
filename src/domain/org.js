/**
 * Organisation identity — turning a company name into an `orgId`.
 *
 * `orgId` is the prefix of the `leadPhoneIndex/{orgId}_{phone}` document key (see
 * src/services/leads.service.js and firestore.rules), so it must never contain an
 * underscore — one would let `key.split('_')[0]` return the wrong org and either leak a
 * neighbour's phone claims or lock an org out of its own. This pattern is duplicated in
 * firestore.rules, functions/index.js and scripts/syncClaims.js; keep all four in step.
 */

export const ORG_ID_PATTERN = /^[a-z0-9-]{2,40}$/

export function isValidOrgId(orgId) {
  return typeof orgId === 'string' && ORG_ID_PATTERN.test(orgId)
}

/**
 * Lowercase, ASCII, hyphen-separated. Clamped to 40 chars (the format's ceiling) and padded
 * to 2 (the format's floor) so a name like "AB" or an all-diacritic name still produces
 * something `ORG_ID_PATTERN` accepts.
 */
export function slugifyOrgId(companyName) {
  const base = String(companyName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after NFKD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  if (base.length >= 2) return base
  // Too short on its own (e.g. "A", or a name that was entirely diacritics/punctuation) —
  // pad with a stable suffix rather than falling through to an invalid orgId.
  return (base + '-org').slice(0, 40)
}

/**
 * The next candidate to try when `base` (or a previous candidate) is already taken.
 *
 * Deterministic suffixing (`acme`, `acme-2`, `acme-3`, …) for the first several attempts —
 * predictable, and good enough for the overwhelming majority of company names, which do not
 * collide. Past `maxDeterministic` attempts we switch to a short random suffix so a very
 * popular name (or a name that happens to collide with something) can never leave
 * registration stuck retrying forever.
 */
export function nextSlugCandidate(base, attempt, { maxDeterministic = 20 } = {}) {
  if (attempt <= 1) return base.slice(0, 40)

  if (attempt <= maxDeterministic) {
    const suffix = `-${attempt}`
    return (base.slice(0, 40 - suffix.length) + suffix).slice(0, 40)
  }

  const suffix = `-${Math.random().toString(36).slice(2, 8)}`
  return (base.slice(0, 40 - suffix.length) + suffix).slice(0, 40)
}
