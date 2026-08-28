/**
 * LogActivityDialog's snooze picker actually shows what is selected.
 *
 * Regression: `snooze` was a ref holding a whole object from the SNOOZES array. Assigning
 * an object to a ref's `.value` makes Vue wrap it in a reactive Proxy (toReactive()), so
 * `snooze.value` was never again `===` the plain array element it was assigned from — every
 * button's `data-on="snooze === option"` check silently evaluated false, and no button ever
 * appeared selected, even though the underlying choice still worked (a Proxy forwards
 * property reads fine, which is exactly why this shipped unnoticed by anything that only
 * checked the SAVED result). Found by a user clicking a snooze option and seeing nothing
 * light up. Fixed by tracking the selection as an index (a primitive, never Proxy-wrapped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

vi.mock('@/services/leads.service.js', () => ({
  logActivity: vi.fn(async () => {}),
  setNextAction: vi.fn(async () => {}),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({ uid: 'u-agent-1', displayName: 'Test Agent', orgId: 'haflaway' }),
}))

vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

const i18n = createI18n({
  legacy: false, locale: 'sw', fallbackLocale: 'en',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

async function mountDialog() {
  const { default: LogActivityDialog } = await import(
    '../../src/components/leads/LogActivityDialog.vue'
  )
  return mount(LogActivityDialog, {
    props: { lead: { id: 'l1', displayName: 'Test Lead' } },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('LogActivityDialog — snooze selection', () => {
  it('marks exactly the clicked snooze button as selected, and only that one', async () => {
    const wrapper = await mountDialog()

    // Pick an outcome that needs a follow-up time (not "spoke") to reveal the snooze picker.
    const outcomeButtons = wrapper.findAll('fieldset')[1].findAll('button')
    await outcomeButtons[1].trigger('click') // 'no_answer'

    const snoozeFieldset = wrapper.findAll('fieldset')[2]
    const snoozeButtons = snoozeFieldset.findAll('button')
    expect(snoozeButtons.length).toBe(6) // 5 presets + "Pick a time"

    // Nothing selected yet.
    for (const button of snoozeButtons) {
      expect(button.attributes('data-on')).toBe('false')
    }

    await snoozeButtons[2].trigger('click') // '3 days'

    // Exactly the clicked button is marked on — this is the assertion that failed before
    // the fix (every button stayed data-on="false" no matter what was clicked).
    snoozeButtons.forEach((button, i) => {
      expect(button.attributes('data-on'), `button ${i}`).toBe(i === 2 ? 'true' : 'false')
    })

    // Clicking a different option moves the selection rather than adding to it.
    await snoozeButtons[4].trigger('click') // '1 week'
    snoozeButtons.forEach((button, i) => {
      expect(button.attributes('data-on'), `button ${i}`).toBe(i === 4 ? 'true' : 'false')
    })
  })

  it('the underlying reminder time still resolves correctly through the fix', async () => {
    const { setNextAction } = await import('@/services/leads.service.js')
    const wrapper = await mountDialog()

    const outcomeButtons = wrapper.findAll('fieldset')[1].findAll('button')
    await outcomeButtons[1].trigger('click') // 'no_answer'

    const snoozeButtons = wrapper.findAll('fieldset')[2].findAll('button')
    await snoozeButtons[0].trigger('click') // '2 hours'

    await wrapper.find('button.btn-primary').trigger('click')

    expect(setNextAction).toHaveBeenCalledTimes(1)
    const call = setNextAction.mock.calls[0][0]
    const deltaMs = call.at.getTime() - Date.now()
    // ~2 hours, generous tolerance for test execution time.
    expect(deltaMs).toBeGreaterThan(1.9 * 3600 * 1000)
    expect(deltaMs).toBeLessThan(2.1 * 3600 * 1000)
  })

  it('"Pick a time" reveals a datetime picker, and the chosen moment is used verbatim', async () => {
    const { setNextAction } = await import('@/services/leads.service.js')
    const wrapper = await mountDialog()

    const outcomeButtons = wrapper.findAll('fieldset')[1].findAll('button')
    await outcomeButtons[1].trigger('click') // 'no_answer'

    const snoozeButtons = wrapper.findAll('fieldset')[2].findAll('button')
    expect(wrapper.find('#custom-remind-at').exists()).toBe(false) // hidden until chosen

    await snoozeButtons[5].trigger('click') // 'Pick a time', the 6th button
    const picker = wrapper.find('#custom-remind-at')
    expect(picker.exists()).toBe(true)
    expect(picker.attributes('type')).toBe('datetime-local')

    // A specific future moment a fixed preset could not have produced.
    await picker.setValue('2026-09-03T14:30')
    await wrapper.find('button.btn-primary').trigger('click')

    expect(setNextAction).toHaveBeenCalledTimes(1)
    const call = setNextAction.mock.calls[0][0]
    expect(call.at.getFullYear()).toBe(2026)
    expect(call.at.getMonth()).toBe(8) // 0-indexed: September
    expect(call.at.getDate()).toBe(3)
    expect(call.at.getHours()).toBe(14)
    expect(call.at.getMinutes()).toBe(30)
  })

  it('picking a preset after "Pick a time" replaces the custom choice, not both', async () => {
    const wrapper = await mountDialog()
    const outcomeButtons = wrapper.findAll('fieldset')[1].findAll('button')
    await outcomeButtons[1].trigger('click')

    const snoozeButtons = wrapper.findAll('fieldset')[2].findAll('button')
    await snoozeButtons[5].trigger('click') // 'Pick a time'
    expect(wrapper.find('#custom-remind-at').exists()).toBe(true)

    await snoozeButtons[0].trigger('click') // '2 hours'
    expect(wrapper.find('#custom-remind-at').exists()).toBe(false)
    expect(snoozeButtons[0].attributes('data-on')).toBe('true')
    expect(snoozeButtons[5].attributes('data-on')).toBe('false')
  })

  it('"We spoke" ALSO reveals the reminder picker — a successful call can still need a follow-up', async () => {
    // Regression: the reminder section used to be hidden specifically for outcome 'spoke',
    // on the assumption a successful call never needs one. A user reported wanting to set a
    // reminder after speaking too (e.g. "confirmed details, remind me to send the quote").
    const wrapper = await mountDialog()
    const outcomeButtons = wrapper.findAll('fieldset')[1].findAll('button')
    await outcomeButtons[0].trigger('click') // 'spoke'

    expect(wrapper.findAll('fieldset').length).toBe(3) // channel, outcome, AND remind-me
    const snoozeButtons = wrapper.findAll('fieldset')[2].findAll('button')
    expect(snoozeButtons.length).toBe(6)

    await snoozeButtons[5].trigger('click') // 'Pick a time'
    expect(wrapper.find('#custom-remind-at').exists()).toBe(true)
  })
})
