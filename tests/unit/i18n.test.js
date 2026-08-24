/**
 * Locale integrity.
 *
 * A key-set diff is NOT enough, and this suite exists because that lesson was learned in a
 * browser rather than in CI. `auth.emailPlaceholder` was present in both files, spelled
 * identically, and diffed clean — but its VALUE was `jina@haflaway.com`, and `@` starts a
 * linked-message reference in vue-i18n. The message failed to compile at render time and
 * the login screen threw a SyntaxError that no test saw.
 *
 * So: every message is pushed through the real vue-i18n compiler here. If it cannot be
 * rendered, this fails.
 *
 * vue-i18n message syntax specials:
 *   @   linked message      — a literal @ must be written {'@'}
 *   |   plural separator    — splits one message into branches
 *   {}  interpolation       — {name} is a named parameter
 *   $   used in @:{'key'}   — only meaningful next to @
 */
import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

const LOCALES = { sw, en }

/** Flatten to [dottedKey, value] pairs. */
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  )
}

const entries = Object.fromEntries(
  Object.entries(LOCALES).map(([code, messages]) => [code, flatten(messages)]),
)

describe('every message compiles through vue-i18n', () => {
  // A real i18n instance, not a regex approximation of one.
  const i18n = createI18n({
    legacy: false,
    locale: 'sw',
    fallbackLocale: 'en',
    messages: LOCALES,
    missingWarn: false,
    fallbackWarn: false,
  })

  for (const [code, pairs] of Object.entries(entries)) {
    it(`${code}: renders all ${pairs.length} messages without a compilation error`, () => {
      i18n.global.locale.value = code
      const failures = []

      for (const [key, value] of pairs) {
        try {
          // Supply every named parameter the message declares, so interpolation-only
          // messages are exercised rather than skipped.
          const params = Object.fromEntries(
            [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => [m[1], '1']),
          )
          const rendered = i18n.global.t(key, params)
          if (typeof rendered !== 'string') {
            failures.push(`${key}: rendered a ${typeof rendered}, not a string`)
          }
        } catch (error) {
          failures.push(`${key} (${JSON.stringify(value)}): ${error.message}`)
        }
      }

      expect(failures, `\n  ${failures.join('\n  ')}\n`).toEqual([])
    })
  }

  it('renders a literal @ in the email placeholder', () => {
    // The exact bug: `@` starts a linked-message reference and must be escaped as {'@'}.
    i18n.global.locale.value = 'sw'
    expect(i18n.global.t('auth.emailPlaceholder')).toContain('@')
    expect(i18n.global.t('auth.emailPlaceholder')).not.toContain('{')
    i18n.global.locale.value = 'en'
    expect(i18n.global.t('auth.emailPlaceholder')).toContain('@')
  })
})

describe('unescaped special characters', () => {
  it('never leaves a bare @ in a message', () => {
    const offenders = []
    for (const [code, pairs] of Object.entries(entries)) {
      for (const [key, value] of pairs) {
        // Legal forms: the escape {'@'}, or a genuine link @:some.key / @.lower:some.key.
        const withoutEscapes = String(value).replace(/\{'@'\}/g, '')
        const withoutLinks = withoutEscapes.replace(/@[.:][\w.:]+/g, '')
        if (withoutLinks.includes('@')) {
          offenders.push(`${code}:${key} = ${JSON.stringify(value)}`)
        }
      }
    }
    expect(offenders, `Write a literal @ as {'@'}:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('never leaves a bare | in a message', () => {
    // `|` separates plural branches; an unintended one silently truncates the message.
    const offenders = []
    for (const [code, pairs] of Object.entries(entries)) {
      for (const [key, value] of pairs) {
        if (String(value).includes('|')) offenders.push(`${code}:${key} = ${JSON.stringify(value)}`)
      }
    }
    expect(offenders, `Bare | is a plural separator:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})

describe('the two locales stay in step', () => {
  const keys = Object.fromEntries(
    Object.entries(entries).map(([code, pairs]) => [code, new Set(pairs.map(([k]) => k))]),
  )

  it('defines the same key set in both', () => {
    const onlySw = [...keys.sw].filter((k) => !keys.en.has(k))
    const onlyEn = [...keys.en].filter((k) => !keys.sw.has(k))
    expect(onlySw, `missing from en.json: ${onlySw.join(', ')}`).toEqual([])
    expect(onlyEn, `missing from sw.json: ${onlyEn.join(', ')}`).toEqual([])
  })

  it('uses the same interpolation parameters for the same key', () => {
    const paramsOf = (v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const swMap = Object.fromEntries(entries.sw)
    const enMap = Object.fromEntries(entries.en)
    const mismatches = []

    for (const key of keys.sw) {
      if (!(key in enMap)) continue
      const a = paramsOf(swMap[key])
      const b = paramsOf(enMap[key])
      if (a.join(',') !== b.join(',')) {
        mismatches.push(`${key}: sw{${a}} vs en{${b}}`)
      }
    }
    expect(mismatches, mismatches.join('\n  ')).toEqual([])
  })

  it('never renders a raw key path to a user', () => {
    // If a key were missing from both files, t() returns the key itself.
    const i18n = createI18n({
      legacy: false,
      locale: 'sw',
      fallbackLocale: 'en',
      messages: LOCALES,
      missingWarn: false,
      fallbackWarn: false,
    })
    for (const [key] of entries.sw) {
      expect(i18n.global.t(key), `${key} resolved to itself`).not.toBe(key)
    }
  })
})
