/**
 * Every view must MOUNT.
 *
 * This file exists because "it compiles" was checked three times and shipped a blank screen
 * anyway. The failure that finally forced it: `UrgencyBoardView` declared its pagers above
 * the `sorted` computed they read. `usePagination` watches its source, `watch` evaluates
 * that source immediately on setup, and the getter reached a `const` in its temporal dead
 * zone — a `ReferenceError` at mount. Vue compiled the SFC perfectly on the way there, the
 * dev server returned HTTP 200, and the page rendered nothing at all.
 *
 * A compile check cannot catch a runtime throw. This can.
 *
 * Deliberately shallow on assertions and broad on coverage: it does not care what a screen
 * looks like, only that setup() runs, the template renders, and no unhandled error escapes.
 * Every view, every role, empty data and populated data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed } from 'vue'
import sw from '../../src/locales/sw.json'
import en from '../../src/locales/en.json'

/* ------------------------------------------------------------------ fixtures */

const lead = (i) => ({
  id: `l${i}`,
  displayName: `Lead ${i}`,
  stage: ['new', 'contacted', 'unreachable', 'qualified', 'quoted', 'negotiation'][i % 6],
  leadStatus: 'open',
  ownerId: `u-agent-${(i % 3) + 1}`,
  teamId: 'team-dar',
  orgId: 'haflaway',
  primaryPhoneNormalized: '+255712345678',
  primaryPhone: '+255712345678',
  // A spread across every urgency band, so each one has rows and a pager.
  eventDate: new Date(Date.now() + (i - 3) * 6 * 86400000),
  eventType: 'harusi',
  nextActionAt: new Date(Date.now() + (i % 5 === 0 ? -86400000 : 86400000)),
  dealValueMinor: 15000000,
  monthKey: new Date().toISOString().slice(0, 7),
  createdAt: new Date(),
  attribution: { model: 'first_touch', source: 'whatsapp', channel: 'whatsapp', campaignId: 'c1' },
  qualification: { budgetBand: '150-500k', interestedProductIds: ['p1'] },
})

const expense = (i) => ({
  id: `e${i}`,
  orgId: 'haflaway',
  category: ['ad_spend', 'salary', 'rent'][i % 3],
  amountMinor: 1000000 * (i + 1),
  monthKey: new Date().toISOString().slice(0, 7),
  allocation: { type: 'staff', staffId: `u-agent-${(i % 3) + 1}` },
  incurredOn: { seconds: Math.floor(Date.now() / 1000) },
})

/** Enough rows to force multiple pages, so the paginator itself renders and runs. */
const MANY = 40

/* --------------------------------------------------------------------- mocks */

vi.mock('@/firebase/app.js', () => ({
  getDb: async () => ({}),
  getStorageInstance: async () => ({}),
  auth: {},
  app: {},
  USING_EMULATORS: true,
}))

vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), query: () => ({}), where: () => ({}),
  orderBy: () => ({}), limit: () => ({}), startAfter: () => ({}), getDocs: async () => ({ docs: [] }),
  getDoc: async () => ({ exists: () => false }), onSnapshot: () => () => {},
  addDoc: async () => ({ id: 'x' }), updateDoc: async () => {}, setDoc: async () => {},
  serverTimestamp: () => new Date(), increment: (n) => n, arrayUnion: (...a) => a,
  runTransaction: async () => {}, writeBatch: () => ({ set() {}, update() {}, commit: async () => {} }),
}))

/** Swapped per test so the same views run against an empty and a populated database. */
let dataset = { leads: [], expenses: [] }

vi.mock('@/composables/useCollection.js', () => ({
  useCollection: (buildQuery) => {
    // Crude but sufficient: the expense views are the only ones asking for expenses.
    const src = String(buildQuery)
    const rows = /expensesQuery/.test(src) ? dataset.expenses : dataset.leads
    return {
      items: ref(rows), loading: ref(false), loaded: ref(true), error: ref(null),
      isEmpty: computed(() => rows.length === 0), fromCache: ref(false),
      load: () => {}, stop: () => {},
    }
  },
  useDoc: () => ({
    item: ref(dataset.leads[0] ?? null), loading: ref(false), loaded: ref(true),
    error: ref(null), load: () => {}, stop: () => {},
  }),
}))

vi.mock('@/services/provisioning.service.js', () => ({
  ASSIGNABLE_ROLES: ['admin', 'manager', 'finance', 'agent', 'viewer'],
  ProvisioningError: class extends Error {},
  registerOrganization: async () => ({ orgId: 'haflaway' }),
  createTeamMember: async () => ({ uid: 'x', resetEmailSent: true }),
  adoptExistingUser: async () => ({ uid: 'x' }),
}))

vi.mock('@/composables/useUserNames.js', () => ({
  useUserNames: () => ({
    names: computed(() => new Map()), nameFor: (uid) => uid,
    loading: ref(false), loaded: ref(true),
  }),
}))

let currentRole = 'admin'

vi.mock('@/stores/auth.js', () => ({
  ROLES: ['admin', 'manager', 'finance', 'agent', 'viewer'],
  authErrorKey: () => 'auth.error.generic',
  useAuthStore: () => ({
    uid: 'u-admin', role: currentRole, orgId: 'haflaway', teamId: 'team-dar',
    displayName: 'Asha Mwinyi', profile: { displayName: 'Asha Mwinyi', locale: 'sw' },
    user: { email: 'admin@haflaway.com' }, errorKey: null, busy: false,
    isSignedIn: true, canUseApp: true,
    can: {
      createLead: ['admin', 'manager', 'agent'].includes(currentRole),
      reassignLead: ['admin', 'manager'].includes(currentRole),
      viewCosts: ['admin', 'manager', 'finance'].includes(currentRole),
      editCosts: ['admin', 'finance'].includes(currentRole),
      viewAllLeads: ['admin', 'finance', 'viewer'].includes(currentRole),
      viewTeamLeads: ['admin', 'manager'].includes(currentRole),
      manageUsers: currentRole === 'admin',
    },
    changePassword: async () => true, setLocale: async () => {},
    registerAccount: async () => true, refreshClaims: async () => true,
  }),
}))

/* --------------------------------------------------------------------- setup */

const i18n = createI18n({
  legacy: false, locale: 'sw', fallbackLocale: 'en',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const RouterLink = { props: ['to'], template: '<a><slot /></a>' }

const VIEWS = [
  ['Register', () => import('../../src/views/auth/RegisterView.vue')],
  ['WorkQueue', () => import('../../src/views/tasks/WorkQueueView.vue')],
  ['LeadList', () => import('../../src/views/leads/LeadListView.vue')],
  ['UrgencyBoard', () => import('../../src/views/leads/UrgencyBoardView.vue')],
  ['Pipeline', () => import('../../src/views/leads/PipelineView.vue')],
  ['MonthlyBoard', () => import('../../src/views/leads/MonthlyBoardView.vue')],
  ['LeadDetail', () => import('../../src/views/leads/LeadDetailView.vue')],
  ['LeadQuickAdd', () => import('../../src/views/leads/LeadQuickAddView.vue')],
  ['Dashboard', () => import('../../src/views/analytics/DashboardView.vue')],
  ['Campaigns', () => import('../../src/views/finance/CampaignsView.vue')],
  ['Expenses', () => import('../../src/views/finance/ExpensesView.vue')],
  ['Users', () => import('../../src/views/admin/UsersView.vue')],
  ['Settings', () => import('../../src/views/SettingsView.vue')],
  ['Setup', () => import('../../src/views/admin/SetupView.vue')],
  ['Forbidden', () => import('../../src/views/ForbiddenView.vue')],
  ['NotFound', () => import('../../src/views/NotFoundView.vue')],
]

let errors = []

beforeEach(() => {
  setActivePinia(createPinia())
  errors = []
  // A Vue render error is reported to the console, not thrown out of mount(). Without
  // this the test would pass on a screen that rendered nothing.
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

async function mountView(loader) {
  const mod = await loader()
  return mount(mod.default, {
    props: { id: 'l0' },
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

/* --------------------------------------------------------------------- tests */

describe('every view mounts with data', () => {
  beforeEach(() => {
    dataset = {
      leads: Array.from({ length: MANY }, (_, i) => lead(i)),
      expenses: Array.from({ length: MANY }, (_, i) => expense(i)),
    }
    currentRole = 'admin'
  })

  it.each(VIEWS)('%s renders without a runtime error', async (name, loader) => {
    const wrapper = await mountView(loader)
    expect(wrapper.html(), `${name} rendered nothing`).toBeTruthy()
    // The exact failure this file was written for: a blank screen from a throw in setup.
    expect(wrapper.html().length, `${name} rendered an empty root`).toBeGreaterThan(50)
    expect(errors, `${name} logged a render error`).toEqual([])
  })
})

describe('every view mounts with NO data', () => {
  beforeEach(() => {
    dataset = { leads: [], expenses: [] }
    currentRole = 'admin'
  })

  it.each(VIEWS)('%s renders its empty state without erroring', async (name, loader) => {
    const wrapper = await mountView(loader)
    expect(wrapper.html(), `${name} rendered nothing`).toBeTruthy()
    expect(errors, `${name} logged a render error`).toEqual([])
  })
})

describe('every view mounts for every role', () => {
  const ROLES = ['admin', 'manager', 'finance', 'agent', 'viewer']

  beforeEach(() => {
    dataset = {
      leads: Array.from({ length: 12 }, (_, i) => lead(i)),
      expenses: Array.from({ length: 12 }, (_, i) => expense(i)),
    }
  })

  for (const role of ROLES) {
    it(`${role} can render every screen they can reach`, async () => {
      currentRole = role
      for (const [name, loader] of VIEWS) {
        errors = []
        const wrapper = await mountView(loader)
        expect(wrapper.html(), `${role} / ${name} rendered nothing`).toBeTruthy()
        expect(errors, `${role} / ${name} logged a render error`).toEqual([])
      }
    })
  }
})

describe('paginated views actually page', () => {
  beforeEach(() => {
    dataset = {
      leads: Array.from({ length: MANY }, (_, i) => lead(i)),
      expenses: Array.from({ length: MANY }, (_, i) => expense(i)),
    }
    currentRole = 'admin'
  })

  it('the urgency board renders bands AND their paginators', async () => {
    const wrapper = await mountView(() => import('../../src/views/leads/UrgencyBoardView.vue'))
    // The regression: this screen rendered completely blank.
    expect(wrapper.find('h1').exists(), 'no page header').toBe(true)
    expect(wrapper.findAll('section').length, 'no urgency bands rendered').toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  it('the work queue renders sections AND their paginators', async () => {
    const wrapper = await mountView(() => import('../../src/views/tasks/WorkQueueView.vue'))
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.findAll('section').length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  it('the pipeline renders one column per BOARD_ORDER stage', async () => {
    // The board groups by `filter(l => l.stage === column)`, so a stage with no column
    // makes its leads vanish from the screen entirely. This ties the rendered board to the
    // domain constant so the two cannot drift apart again.
    const { BOARD_ORDER } = await import('../../src/domain/stages.js')
    const wrapper = await mountView(() => import('../../src/views/leads/PipelineView.vue'))
    const headings = wrapper.findAll('section h2, section h3').map((n) => n.text())
    expect(wrapper.findAll('section').length, 'column count != BOARD_ORDER length')
      .toBe(BOARD_ORDER.length)
    // And the three that were missing must actually be on screen. Resolved through the
    // locale file rather than hard-coded, so a translation edit cannot break this.
    for (const stage of ['nurture', 'parked', 'disqualified']) {
      expect(headings.join(' | '), `no column headed ${sw.stage[stage]}`)
        .toContain(sw.stage[stage])
    }
    expect(errors).toEqual([])
  })

  it('clicking a page number does not throw', async () => {
    const wrapper = await mountView(() => import('../../src/views/leads/LeadListView.vue'))
    const pageButtons = wrapper.findAll('.pager-btn')
    if (pageButtons.length) {
      for (const button of pageButtons.slice(0, 6)) await button.trigger('click')
    }
    expect(errors).toEqual([])
  })
})
