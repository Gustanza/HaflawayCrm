/**
 * The confirmation gate on the one irreversible action in the product.
 *
 * The service is covered in tests/unit/delete-lead.test.js. What matters HERE is that an
 * admin cannot reach it by accident: the button stays dead until the lead's name has been
 * typed out and a reason given, and an offline click refuses outright rather than queueing
 * a multi-step cascade to run unattended hours later.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

vi.mock('@/firebase/app.js', () => ({
  getDb: async () => ({}), auth: {}, app: {}, USING_EMULATORS: true,
}))

const deleteLeadSpy = vi.fn(async () => ({ leadId: 'l1', removed: {}, phoneReleased: true }))

vi.mock('@/services/leads.service.js', () => ({
  deleteLead: (...args) => deleteLeadSpy(...args),
  LEAD_SUBCOLLECTIONS: ['activities', 'contacts', 'quotes'],
}))

const uiError = vi.fn()
vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: vi.fn(), error: uiError }),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({
    uid: 'u-admin', role: 'admin', orgId: 'haflaway', displayName: 'Admin',
    can: { deleteLead: true },
  }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en', fallbackLocale: 'sw',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const LEAD = {
  id: 'l1',
  orgId: 'haflaway',
  displayName: 'Amina Hassan',
  primaryPhoneNormalized: '+255712345678',
  stage: 'contacted',
  leadStatus: 'open',
}

async function mountDialog(props = {}) {
  const { default: DeleteLeadDialog } = await import(
    '../../src/components/leads/DeleteLeadDialog.vue'
  )
  return mount(DeleteLeadDialog, {
    props: { lead: LEAD, inventory: { activities: 12, contacts: 0, quotes: 2 }, ...props },
    global: { plugins: [i18n] },
  })
}

/** The rose confirm button, found by its label rather than its position. */
const confirmButton = (wrapper) =>
  wrapper.findAll('button').find((b) => b.text() === 'Delete permanently')

let wrapper

beforeEach(() => {
  setActivePinia(createPinia())
  deleteLeadSpy.mockClear()
  uiError.mockClear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  wrapper?.unmount()
  wrapper = undefined
})

describe('what the admin is told before deciding', () => {
  it('names what will be destroyed, with counts', async () => {
    wrapper = await mountDialog()
    expect(wrapper.text()).toContain('12 timeline entries')
    expect(wrapper.text()).toContain('2 quotes')
  })

  it('omits the empty ones rather than listing a zero', async () => {
    wrapper = await mountDialog()
    expect(wrapper.text()).not.toContain('0 saved contacts')
  })

  it('warns that a won lead moves its campaign CAC', async () => {
    wrapper = await mountDialog({ lead: { ...LEAD, stage: 'won', leadStatus: 'won' } })
    expect(wrapper.text()).toContain('cost per customer will change')
  })

  it('says the phone number will be freed when the lead holds one', async () => {
    wrapper = await mountDialog()
    expect(wrapper.text()).toContain('freeing it to be added again')
  })
})

describe('the confirmation gate', () => {
  it('starts disabled', async () => {
    wrapper = await mountDialog()
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('stays disabled with a reason but no typed name', async () => {
    wrapper = await mountDialog()
    await wrapper.find('#delete-reason').setValue('duplicate')
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('stays disabled with the typed name but no reason', async () => {
    wrapper = await mountDialog()
    await wrapper.find('#delete-confirm').setValue('Amina Hassan')
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('rejects a near-miss on the name', async () => {
    wrapper = await mountDialog()
    await wrapper.find('#delete-reason').setValue('duplicate')
    await wrapper.find('#delete-confirm').setValue('amina hassan')
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('enables only with both, and passes the reason through', async () => {
    wrapper = await mountDialog()
    await wrapper.find('#delete-reason').setValue('duplicate of l9')
    await wrapper.find('#delete-confirm').setValue('Amina Hassan')
    expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined()

    await confirmButton(wrapper).trigger('click')
    expect(deleteLeadSpy).toHaveBeenCalledTimes(1)
    expect(deleteLeadSpy.mock.calls[0][0]).toMatchObject({ reason: 'duplicate of l9' })
    expect(wrapper.emitted('deleted')).toBeTruthy()
  })

  it('lets an unnamed lead be confirmed by its id', async () => {
    wrapper = await mountDialog({ lead: { ...LEAD, displayName: '' } })
    await wrapper.find('#delete-reason').setValue('junk record')
    await wrapper.find('#delete-confirm').setValue('l1')
    expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})

describe('failure paths', () => {
  it('refuses offline instead of queueing the cascade', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    wrapper = await mountDialog()
    await wrapper.find('#delete-reason').setValue('duplicate')
    await wrapper.find('#delete-confirm').setValue('Amina Hassan')
    await confirmButton(wrapper).trigger('click')

    expect(deleteLeadSpy).not.toHaveBeenCalled()
    expect(uiError).toHaveBeenCalled()
  })

  it('stays open when the delete fails, so it can be retried', async () => {
    deleteLeadSpy.mockRejectedValueOnce(new Error('permission-denied'))
    wrapper = await mountDialog()
    await wrapper.find('#delete-reason').setValue('duplicate')
    await wrapper.find('#delete-confirm').setValue('Amina Hassan')
    await confirmButton(wrapper).trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('deleted')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
    expect(uiError).toHaveBeenCalled()
    // Re-armed, not stuck in a spinner.
    expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})
