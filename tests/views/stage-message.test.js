/**
 * The wording of a blocked stage move.
 *
 * The bug: the domain layer returns developer-facing text naming the STORAGE PATH of a
 * missing field, and it went straight into a toast — "Fill in dealValueMinor before moving
 * to won." That asks a Swahili-speaking agent to fill in a camelCase identifier that
 * appears nowhere on screen, in a language the rest of the page is not written in.
 */
import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'
import { useStageMessage } from '../../src/composables/useStageMessage.js'
import { validateTransition } from '../../src/domain/stages.js'

/** The composable needs an i18n context, so exercise it inside a throwaway component. */
function withLocale(locale, fn) {
  const i18n = createI18n({
    legacy: false, locale, fallbackLocale: 'en',
    messages: { sw, en }, missingWarn: false, fallbackWarn: false,
  })
  let out
  const Probe = defineComponent({
    setup() {
      out = fn(useStageMessage())
      return () => null
    },
  })
  mount(Probe, { global: { plugins: [i18n] } }).unmount()
  return out
}

describe('a blocked move explains itself in words', () => {
  it('names the field the way the interface does, not the way the database does', () => {
    const check = validateTransition({ stage: 'lost' }, 'won', { role: 'admin' })
    const msg = withLocale('en', ({ messageFor }) => messageFor(check, 'won'))

    expect(msg).toContain('deal value')
    expect(msg).toContain('Won')
    expect(msg, 'a storage path must never reach a user').not.toContain('dealValueMinor')
  })

  it('translates, rather than falling back to the English the domain returns', () => {
    const check = validateTransition({ stage: 'contacted' }, 'lost', { role: 'agent' })
    const msg = withLocale('sw', ({ messageFor }) => messageFor(check, 'lost'))

    expect(msg).toContain('sababu ya kupoteza')
    expect(msg).not.toContain('lossReason')
    expect(msg).not.toMatch(/before moving/i)
  })

  it('handles the nested qualification paths, which vue-i18n would read as nesting', () => {
    const check = validateTransition({ stage: 'new' }, 'qualified', { role: 'admin' })
    const msg = withLocale('en', ({ messageFor }) => messageFor(check, 'qualified'))

    expect(msg).toContain('budget')
    expect(msg).toContain('decision maker')
    expect(msg).not.toContain('qualification.')
  })

  it('distinguishes a zero deal value from a missing one', () => {
    const check = validateTransition({ stage: 'quoted', dealValueMinor: 0 }, 'won', { role: 'admin' })
    const msg = withLocale('en', ({ messageFor }) => messageFor(check, 'won'))
    expect(msg).toMatch(/above zero/i)
  })

  it('tells an agent who to ask when a reopen is refused', () => {
    const check = validateTransition({ stage: 'lost' }, 'contacted', { role: 'agent' })
    const msg = withLocale('en', ({ messageFor }) => messageFor(check, 'contacted'))
    expect(msg).toMatch(/manager/i)
  })

  it('marks a missing-field block as fixable, and a permission one as not', () => {
    const missing = validateTransition({ stage: 'quoted' }, 'won', { role: 'admin' })
    const forbidden = validateTransition({ stage: 'lost' }, 'contacted', { role: 'agent' })
    const flags = withLocale('en', ({ isFixable }) => [isFixable(missing), isFixable(forbidden)])
    expect(flags).toEqual([true, false])
  })

  it('falls back to the raw path rather than leaving a hole in the sentence', () => {
    const msg = withLocale('en', ({ fieldLabel }) => fieldLabel('somethingNobodyTranslated'))
    expect(msg).toBe('somethingNobodyTranslated')
  })
})
