/**
 * "It is overdue - so what am I supposed to do with it?"
 *
 * A work-queue row used to state that a follow-up had lapsed and withhold the one thing
 * that makes it actionable. "No answer, 3 tries" and "We spoke - wants the quote by Friday"
 * are the same colour of overdue and completely different jobs.
 *
 * The information lives in the timeline (P1), but rendering it from there would cost one
 * subcollection query per row (11.3), so logActivity() copies the head of the timeline onto
 * the lead. These cover the copy staying honest - especially when it is retracted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

vi.mock('@/firebase/app.js', () => ({
  getDb: async () => ({}), auth: {}, app: {}, USING_EMULATORS: true,
}))

const i18n = createI18n({
  legacy: false, locale: 'en', fallbackLocale: 'sw',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

async function mountCell(lead) {
  const { default: LastContact } = await import('../../src/components/leads/LastContact.vue')
  return mount(LastContact, { props: { lead }, global: { plugins: [i18n] } })
}

let wrapper
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('what happened last time', () => {
  it('shows the outcome and the note together', async () => {
    wrapper = await mountCell({
      lastOutcome: 'spoke',
      lastNote: 'Wants the quote by Friday',
    })
    expect(wrapper.text()).toContain('We spoke')
    expect(wrapper.text()).toContain('Wants the quote by Friday')
  })

  // The bug this catches: outcomes are STORED snake_case (`no_answer`) but their messages
  // are keyed camelCase (`noAnswer`). Three places each bridged that themselves; the
  // fourth got it wrong and rendered `activity.outcome.no_answer` at the user. The mapping
  // now lives once, in outcomeMessageKey().
  it.each(['spoke', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback_requested'])(
    'translates %s rather than printing the stored token',
    async (lastOutcome) => {
      wrapper = await mountCell({ lastOutcome })
      // Not `not.toContain(lastOutcome)`: "We spoke" legitimately contains "spoke". What
      // must never appear is an unresolved key, or the snake_case shape of a stored token.
      expect(wrapper.text()).not.toContain('activity.outcome')
      expect(wrapper.text(), 'a stored token leaked through').not.toMatch(/\w_\w/)
    },
  )

  it('translates into Swahili too, without leaking a key', async () => {
    // A fresh instance: mutating the shared one leaks the locale into whatever runs next.
    const { default: LastContact } = await import('../../src/components/leads/LastContact.vue')
    const swahili = createI18n({
      legacy: false, locale: 'sw', fallbackLocale: 'en',
      messages: { sw, en }, missingWarn: false, fallbackWarn: false,
    })
    const w = mount(LastContact, {
      props: { lead: { lastOutcome: 'no_answer' } },
      global: { plugins: [swahili] },
    })
    expect(w.text()).toContain('Hapokei')
    w.unmount()
  })

  it('says a repeated no-answer is a pattern, not a coincidence', async () => {
    wrapper = await mountCell({ lastOutcome: 'no_answer', consecutiveNoAnswer: 3 })
    expect(wrapper.text()).toContain('3 tries')
  })

  it('stays quiet about a single missed call', async () => {
    wrapper = await mountCell({ lastOutcome: 'no_answer', consecutiveNoAnswer: 1 })
    expect(wrapper.text()).not.toContain('tries')
  })

  it('renders a note with no outcome - a bare note is still what happened', async () => {
    wrapper = await mountCell({ lastNote: 'Left a message with her sister' })
    expect(wrapper.text()).toContain('Left a message with her sister')
  })

  it('marks a never-worked lead as its own state, not as a blank cell', async () => {
    wrapper = await mountCell({ displayName: 'Fresh' })
    expect(wrapper.text()).toBe('—')
  })

  it('keeps the full note reachable when the cell truncates it', async () => {
    const note = 'She asked whether the invitation cards can be printed in gold foil'
    wrapper = await mountCell({ lastOutcome: 'spoke', lastNote: note })
    expect(wrapper.find(`[title="${note}"]`).exists()).toBe(true)
  })
})
