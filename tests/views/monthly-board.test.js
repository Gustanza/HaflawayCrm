/**
 * The month grid.
 *
 * The numbers ARE the feature here, unlike every other list screen where the page is just
 * a window onto documents. So these assert the arithmetic and the two things most likely to
 * make it quietly wrong: which date the months are cut on (§8.8, cohort ≠ period), and
 * leads that belong to no month at all.
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

/** Fixed clock, so "this month" is not whatever day the suite happens to run. */
const NOW = new Date('2026-08-15T09:00:00+03:00')

let ranged = []
let undated = []
const loadSpy = vi.fn()

// Two useCollection call sites in the view: the windowed range, then the undated leads.
// Order of construction is what tells them apart.
let constructed = 0
vi.mock('@/composables/useCollection.js', () => ({
  useCollection: () => {
    const mine = constructed++
    return {
      items: computed(() => (mine % 2 === 0 ? ranged : undated)),
      loading: ref(false), loadingMore: ref(false), loaded: ref(true), error: ref(null),
      isEmpty: computed(() => false), fromCache: ref(false), hasMore: computed(() => false),
      load: loadSpy, loadMore: () => {}, stop: () => {},
    }
  },
}))

vi.mock('@/composables/useNow.js', () => ({ useNow: () => ref(NOW) }))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({
    uid: 'u-admin', role: 'admin', orgId: 'haflaway', teamId: null, displayName: 'Admin',
    can: { viewCosts: true, createLead: true },
  }),
}))

vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en', fallbackLocale: 'sw',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const RouterLink = { props: ['to'], template: '<a><slot /></a>' }

const lead = (name, stage, eventDate, createdAt = NOW) => ({
  id: `l-${name}`, displayName: name, stage, leadStatus: 'open',
  eventDate, createdAt, ownerId: 'u-admin', dealValueMinor: null,
})

async function mountGrid() {
  constructed = 0
  const { default: View } = await import('../../src/views/leads/MonthlyBoardView.vue')
  return mount(View, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink, RouterView: true },
      mocks: {
        $route: { name: 'months', params: {}, query: {} },
        $router: { push: () => {}, replace: () => {}, back: () => {} },
      },
    },
  })
}

/**
 * The month label exactly as the view renders it — derived, not hardcoded, because ICU
 * disagrees with itself about September ("Sep" vs "Sept") across versions and locales.
 */
const label = (y, m) =>
  new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date(Date.UTC(y, m - 1, 15)))

const SEP = label(2026, 9)
const OCT = label(2026, 10)
const AUG = label(2026, 8)

/** The count buttons in one month row, by the row's visible month label. */
function rowCounts(wrapper, label) {
  const row = wrapper.findAll('tbody tr').find((r) => r.text().startsWith(label))
  if (!row) return null
  return row.findAll('td').slice(1).map((c) => c.text())
}

let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  ranged = []
  undated = []
  loadSpy.mockClear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('the grid counts', () => {
  it('buckets leads into their event month and stage', async () => {
    ranged = [
      lead('A', 'new', new Date('2026-09-10T09:00:00+03:00')),
      lead('B', 'new', new Date('2026-09-20T09:00:00+03:00')),
      lead('C', 'contacted', new Date('2026-09-25T09:00:00+03:00')),
      lead('D', 'new', new Date('2026-10-02T09:00:00+03:00')),
    ]
    wrapper = await mountGrid()

    // Sep: 2 new, 1 contacted, total 3. Oct: 1 new, total 1.
    expect(rowCounts(wrapper, SEP)).toEqual(['2', '1', '3', '—'])
    expect(rowCounts(wrapper, OCT)).toEqual(['1', '—', '1', '—'])
  })

  it('cuts the month in ORG time, not the browser timezone', async () => {
    // 23:30 on 30 September in Dar es Salaam is still September there, and already
    // October in UTC+4. A grid that bucketed in host time would move this lead.
    ranged = [lead('Edge', 'new', new Date('2026-09-30T23:30:00+03:00'))]
    wrapper = await mountGrid()

    expect(rowCounts(wrapper, SEP)[0]).toBe('1')
    expect(rowCounts(wrapper, OCT)[0]).toBe('—')
  })

  it('renders an empty cell as a dash, so a grid of noughts is not mistaken for data', async () => {
    ranged = [lead('A', 'new', new Date('2026-09-10T09:00:00+03:00'))]
    wrapper = await mountGrid()
    expect(rowCounts(wrapper, OCT)).toEqual(['—', '0', '—'])
  })

  it('gives a column only to stages that are actually present', async () => {
    ranged = [lead('A', 'nurture', new Date('2026-09-10T09:00:00+03:00'))]
    wrapper = await mountGrid()

    const headers = wrapper.findAll('thead th').map((h) => h.text())
    expect(headers).toContain('Nurture')
    expect(headers).not.toContain('Negotiation')
  })

  it('marks the current month, so "now" is findable in a grid of twelve', async () => {
    ranged = [lead('A', 'new', new Date('2026-08-20T09:00:00+03:00'))]
    wrapper = await mountGrid()

    const row = wrapper.findAll('tbody tr').find((r) => r.text().startsWith(AUG))
    expect(row.text()).toContain('now')
  })
})

describe('leads that belong to no month', () => {
  it('are named rather than dropped', async () => {
    ranged = [lead('Dated', 'new', new Date('2026-09-10T09:00:00+03:00'))]
    undated = [lead('Undated', 'new', null)]
    wrapper = await mountGrid()

    // Silently omitting them would make this grid's totals disagree with every other
    // screen, and a missing event date is the most consequential gap in the data (P2).
    expect(wrapper.text()).toContain('No event date')
  })

  it('says nothing when every lead has a date', async () => {
    ranged = [lead('Dated', 'new', new Date('2026-09-10T09:00:00+03:00'))]
    undated = []
    wrapper = await mountGrid()
    expect(wrapper.text()).not.toContain('No event date')
  })
})

describe('lost leads', () => {
  it('are excluded by default — "on the table" is work you still have', async () => {
    ranged = [
      lead('Live', 'new', new Date('2026-09-10T09:00:00+03:00')),
      lead('Gone', 'lost', new Date('2026-09-11T09:00:00+03:00')),
    ]
    wrapper = await mountGrid()

    const headers = wrapper.findAll('thead th').map((h) => h.text())
    expect(headers).not.toContain('Lost')
    expect(rowCounts(wrapper, SEP).at(-2)).toBe('1')
  })

  it('come back when asked for', async () => {
    ranged = [
      lead('Live', 'new', new Date('2026-09-10T09:00:00+03:00')),
      lead('Gone', 'lost', new Date('2026-09-11T09:00:00+03:00')),
    ]
    wrapper = await mountGrid()

    const toggle = wrapper.findAll('input[type=checkbox]')[0]
    await toggle.setValue(true)
    expect(wrapper.findAll('thead th').map((h) => h.text())).toContain('Lost')
  })

  it('keeps Won — a booked wedding is the most on-the-table thing there is', async () => {
    ranged = [lead('Booked', 'won', new Date('2026-09-10T09:00:00+03:00'))]
    wrapper = await mountGrid()
    expect(wrapper.findAll('thead th').map((h) => h.text())).toContain('Won')
  })
})

describe('the two clocks are not interchangeable (§8.8)', () => {
  it('re-issues the query when the grouping changes, not just the rendering', async () => {
    ranged = [lead('A', 'new', new Date('2026-09-10T09:00:00+03:00'))]
    wrapper = await mountGrid()
    loadSpy.mockClear()

    const byCaptured = wrapper.findAll('button').find((b) => b.text() === 'Month captured')
    await byCaptured.trigger('click')

    // The range bounds and the date field are baked into the query, so switching clocks
    // cannot be answered by re-filtering what is already loaded.
    expect(loadSpy).toHaveBeenCalled()
  })

  it('names both, rather than switching silently', async () => {
    ranged = [lead('A', 'new', new Date('2026-09-10T09:00:00+03:00'))]
    wrapper = await mountGrid()
    expect(wrapper.text()).toContain('Event month')
    expect(wrapper.text()).toContain('Month captured')
  })
})

describe('drilling into a cell', () => {
  it('lists exactly the leads behind the number', async () => {
    ranged = [
      lead('Asha', 'new', new Date('2026-09-10T09:00:00+03:00')),
      lead('Baraka', 'new', new Date('2026-09-11T09:00:00+03:00')),
      lead('Chidi', 'contacted', new Date('2026-09-12T09:00:00+03:00')),
    ]
    wrapper = await mountGrid()

    const row = wrapper.findAll('tbody tr').find((r) => r.text().startsWith(SEP))
    await row.findAll('button')[0].trigger('click')

    const drill = wrapper.find('[aria-live="polite"]')
    expect(drill.text()).toContain('Asha')
    expect(drill.text()).toContain('Baraka')
    expect(drill.text()).not.toContain('Chidi')
  })
})
