/**
 * The Work Queue's Overdue/Today/Coming up sections actually reclassify a lead as time
 * passes, with NO new data arriving — not just at the moment the page loads.
 *
 * Regression: `bucketOf()` read `Date.now()` imperatively inside a `computed()`. Vue's
 * `computed()` only re-runs when a REACTIVE value it touched changes — a plain `Date.now()`
 * read is not reactive — so a lead correctly shown under "Coming up" when the page loaded
 * stayed there even hours after its reminder time had actually passed, until an unrelated
 * Firestore write forced a re-render. Found by a user asking "does this always work like
 * that" about the exact section a lead sits in. Fixed with useNow(), a ref that ticks on its
 * own interval, so the sections recompute independently of any data change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed, nextTick } from 'vue'
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

let leads = []

vi.mock('@/composables/useCollection.js', () => ({
  useCollection: () => ({
    items: computed(() => leads),
    loading: ref(false),
    loaded: ref(true),
    error: ref(null),
    isEmpty: computed(() => leads.length === 0),
    fromCache: ref(false),
    load: () => {},
    stop: () => {},
  }),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({
    uid: 'u-agent-1', role: 'agent', orgId: 'haflaway', teamId: 'team-dar',
    displayName: 'Test Agent',
    can: { createLead: true, reassignLead: false, viewCosts: false },
  }),
}))

vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

const i18n = createI18n({
  legacy: false, locale: 'sw', fallbackLocale: 'en',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const RouterLink = { props: ['to'], template: '<a><slot /></a>' }

async function mountQueue() {
  const { default: WorkQueueView } = await import('../../src/views/tasks/WorkQueueView.vue')
  return mount(WorkQueueView, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink, RouterView: true },
      mocks: {
        $route: { name: 'work-queue', params: {}, query: {} },
        $router: { push: () => {}, replace: () => {}, back: () => {} },
      },
    },
  })
}

let wrapper

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  // useNow() holds a real setInterval alive via onScopeDispose, which only fires on
  // unmount — leaving it running (even a fake-timer one, which still occupies the fake
  // clock's callback queue) bled into and slowed down unrelated later tests/files.
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('WorkQueueView — sections stay correct as the clock moves', () => {
  it('reclassifies a lead from "Coming up" to "Overdue" purely from time passing, no new data', async () => {
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))

    // Due in 90 seconds — inside "today"/"upcoming" depending on the exact minute, but
    // definitely NOT overdue at mount time.
    leads = [
      {
        id: 'l1',
        displayName: 'Clock Test Lead',
        stage: 'contacted',
        leadStatus: 'open',
        primaryPhoneNormalized: '+255712345678',
        eventDate: new Date('2026-09-15T00:00:00Z'),
        eventType: 'harusi',
        nextActionAt: new Date(Date.now() + 90 * 1000),
      },
    ]

    wrapper = await mountQueue()
    await nextTick()

    expect(wrapper.find('#q-overdue').exists(), 'should not start overdue').toBe(false)
    expect(wrapper.text()).toContain('Clock Test Lead')

    // Cross the 90-second mark, and let useNow's interval (60s ticks) fire at least twice.
    vi.advanceTimersByTime(3 * 60 * 1000)
    await nextTick()
    // A microtask flush for good measure — the setInterval callback runs synchronously with
    // fake timers, but Vue's reactivity flush is a microtask.
    await Promise.resolve()
    await nextTick()

    expect(wrapper.find('#q-overdue').exists(), 'should be overdue once its time has passed').toBe(true)
    // Still the same lead, now under the Overdue heading — not duplicated, not dropped.
    expect(wrapper.find('#q-overdue').element.closest('section').textContent).toContain('Clock Test Lead')
  })
})
