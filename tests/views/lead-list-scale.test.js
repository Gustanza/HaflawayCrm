/**
 * LeadListView.vue's scale/visibility fixes, driven end to end against a controlled
 * `useCollection` mock:
 *
 *   1. Owner name actually renders for a role that can see other people's leads — the bug
 *      was `show-owner` being wired everywhere but `owner-name` never actually supplied,
 *      so it silently rendered nothing regardless of role.
 *   2. The owner filter narrows the visible list.
 *   3. "Load more" is hidden when `hasMore` is false, and calls `loadMore()` when clicked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed } from 'vue'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

vi.mock('@/firebase/app.js', () => ({
  getDb: async () => ({}), auth: {}, app: {}, USING_EMULATORS: true,
}))

vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), query: () => ({}), where: () => ({}),
  orderBy: () => ({}), limit: () => ({}), getDocs: async () => ({ docs: [] }),
  onSnapshot: () => () => {},
}))

const lead = (i, ownerId) => ({
  id: `l${i}`,
  displayName: `Lead ${i}`,
  ownerId,
  stage: 'contacted',
  leadStatus: 'open',
  primaryPhoneNormalized: '+255712345678',
  eventDate: new Date(Date.now() + 5 * 86400000),
  eventType: 'harusi',
})

let leads
let hasMoreValue
const loadMoreSpy = vi.fn()

vi.mock('@/composables/useCollection.js', () => ({
  useCollection: () => ({
    items: computed(() => leads),
    loading: ref(false),
    loadingMore: ref(false),
    loaded: ref(true),
    error: ref(null),
    isEmpty: computed(() => leads.length === 0),
    fromCache: ref(false),
    hasMore: computed(() => hasMoreValue),
    load: () => {},
    loadMore: loadMoreSpy,
    stop: () => {},
  }),
}))

vi.mock('@/composables/useUserNames.js', () => ({
  useUserNames: () => ({
    names: computed(() => new Map()),
    nameFor: (uid) => ({ 'u-agent-1': 'Zawadi Juma', 'u-agent-2': 'Baraka Elias' })[uid] ?? uid,
    loading: ref(false),
    loaded: ref(true),
  }),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({
    uid: 'u-admin', role: 'admin', orgId: 'haflaway', teamId: null,
    displayName: 'Admin',
    can: { createLead: true, viewAllLeads: true, viewTeamLeads: false },
  }),
}))

vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en', fallbackLocale: 'sw',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const RouterLink = { props: ['to'], template: '<a><slot /></a>' }

async function mountList() {
  const { default: LeadListView } = await import('../../src/views/leads/LeadListView.vue')
  return mount(LeadListView, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink, RouterView: true },
      mocks: {
        $route: { name: 'leads', params: {}, query: {} },
        $router: { push: () => {}, replace: () => {}, back: () => {} },
      },
    },
  })
}

let wrapper

beforeEach(() => {
  setActivePinia(createPinia())
  loadMoreSpy.mockClear()
})

afterEach(() => {
  // LeadListView's useNow() holds a real setInterval alive via onScopeDispose, which only
  // fires on unmount — leaving several of these running bled into and slowed down
  // unrelated later tests/files.
  wrapper?.unmount()
  wrapper = undefined
})

describe('LeadListView — owner visibility and load more', () => {
  it('shows the owner name for a role that can see other leads — the fixed bug', async () => {
    leads = [lead(1, 'u-agent-1'), lead(2, 'u-agent-2')]
    hasMoreValue = false
    wrapper = await mountList()

    expect(wrapper.text()).toContain('Zawadi Juma')
    expect(wrapper.text()).toContain('Baraka Elias')
  })

  it('the owner filter narrows the list to one owner', async () => {
    leads = [lead(1, 'u-agent-1'), lead(2, 'u-agent-2'), lead(3, 'u-agent-1')]
    hasMoreValue = false
    wrapper = await mountList()

    expect(wrapper.text()).toContain('Lead 1')
    expect(wrapper.text()).toContain('Lead 2')
    expect(wrapper.text()).toContain('Lead 3')

    const select = wrapper.find('#lead-owner')
    expect(select.exists()).toBe(true)
    await select.setValue('u-agent-1')

    expect(wrapper.text()).toContain('Lead 1')
    expect(wrapper.text()).toContain('Lead 3')
    expect(wrapper.text()).not.toContain('Lead 2')
  })

  it('"Load more" is hidden when there is nothing more to load', async () => {
    leads = [lead(1, 'u-agent-1')]
    hasMoreValue = false
    wrapper = await mountList()
    expect(wrapper.text()).not.toContain('Load more')
  })

  it('"Load more" appears and calls loadMore() when there might be more', async () => {
    leads = Array.from({ length: 25 }, (_, i) => lead(i, 'u-agent-1'))
    hasMoreValue = true
    wrapper = await mountList()

    const button = wrapper.findAll('button').find((b) => b.text() === 'Load more')
    expect(button, 'Load more button not found').toBeTruthy()

    await button.trigger('click')
    expect(loadMoreSpy).toHaveBeenCalledTimes(1)
  })
})
