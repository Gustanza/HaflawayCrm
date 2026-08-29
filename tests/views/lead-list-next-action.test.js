/**
 * The lead list's follow-up clock — the "Next action" column, the urgency chips, and the
 * sort (§10.2).
 *
 * The bug this covers: an agent logs a call, picks "2 hours" in the Remind me row, saves —
 * and the lead list looks exactly as it did before. The reminder WAS stored on
 * `nextActionAt`; the table simply had no column for it, and the only signal it ever gave
 * was a pale pink row tint that appeared once the time had already passed. The Event column
 * next to it shows a different clock entirely (the customer's wedding), which made the
 * absence easy to miss.
 *
 * So these assert on what an agent can actually see and press, not on internal state.
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

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** `nextActionAt` is what the Remind me row in LogActivityDialog writes. */
const lead = (name, nextActionAt, overrides = {}) => ({
  id: `l-${name}`,
  displayName: name,
  ownerId: 'u-agent-1',
  stage: 'contacted',
  leadStatus: 'open',
  primaryPhoneNormalized: '+255712345678',
  eventDate: new Date(Date.now() + 30 * DAY),
  eventType: 'harusi',
  nextActionAt,
  ...overrides,
})

let leads = []

vi.mock('@/composables/useCollection.js', () => ({
  useCollection: () => ({
    items: computed(() => leads),
    loading: ref(false),
    loadingMore: ref(false),
    loaded: ref(true),
    error: ref(null),
    isEmpty: computed(() => leads.length === 0),
    fromCache: ref(false),
    hasMore: computed(() => false),
    load: () => {},
    loadMore: () => {},
    stop: () => {},
  }),
}))

vi.mock('@/composables/useUserNames.js', () => ({
  useUserNames: () => ({
    names: computed(() => new Map()),
    nameFor: (uid) => uid,
    loading: ref(false),
    loaded: ref(true),
  }),
}))

vi.mock('@/stores/auth.js', () => ({
  useAuthStore: () => ({
    uid: 'u-agent-1', role: 'agent', orgId: 'haflaway', teamId: 'team-dar',
    displayName: 'Test Agent',
    can: { createLead: true, viewAllLeads: false, viewTeamLeads: false },
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

/** The visible lead names, in the order the table actually renders them. */
function rowNames(wrapper) {
  return wrapper.findAll('tbody tr').map((row) => row.find('td').text())
}

function chip(wrapper, label) {
  return wrapper.findAll('button').find((b) => b.text().startsWith(label))
}

let wrapper

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  // useNow() holds a real setInterval alive until unmount — see lead-list-scale.test.js.
  wrapper?.unmount()
  wrapper = undefined
})

describe('the Next action column', () => {
  it('shows a 2-hour reminder as hours — the case a day count rendered as nothing', async () => {
    leads = [lead('Idi', new Date(Date.now() + 2 * HOUR))]
    wrapper = await mountList()

    expect(wrapper.text()).toContain('Next action')
    expect(wrapper.text()).toContain('in 2h')
  })

  it('shows a lead with no reminder as a dash, never as a blank cell', async () => {
    leads = [lead('Braka', null)]
    wrapper = await mountList()

    const cells = wrapper.findAll('tbody tr td')
    expect(cells[2].text()).toBe('—')
  })

  it('spells out "Overdue" in words, so colour is never the only signal', async () => {
    leads = [lead('Late', new Date(Date.now() - 5 * HOUR))]
    wrapper = await mountList()

    expect(wrapper.text()).toContain('5h overdue')
    // The loud state (§10.2) is a filled pill, not tinted text on white.
    expect(wrapper.find('tbody .bg-rose-600').exists()).toBe(true)
  })

  it('keeps the event clock and the follow-up clock as separate columns', async () => {
    leads = [lead('Both', new Date(Date.now() + 2 * HOUR), {
      eventDate: new Date(Date.now() + 3 * DAY),
    })]
    wrapper = await mountList()

    // `toContain`, not `toBe`: both headers carry an sr-only sort label as well.
    const headers = wrapper.findAll('thead th').map((h) => h.text())
    expect(headers[1]).toContain('Event')
    expect(headers[2]).toContain('Next action')
    expect(wrapper.text()).toContain('in 3 days') // the wedding
    expect(wrapper.text()).toContain('in 2h') // the callback
  })
})

describe('the follow-up filter chips', () => {
  it('narrows the list to overdue leads only', async () => {
    leads = [
      lead('Late', new Date(Date.now() - 2 * DAY)),
      lead('Soon', new Date(Date.now() + 2 * HOUR)),
      lead('Nothing', null),
    ]
    wrapper = await mountList()
    expect(rowNames(wrapper)).toHaveLength(3)

    await chip(wrapper, 'Overdue').trigger('click')
    expect(rowNames(wrapper)).toEqual(['Late'])
  })

  it('finds the leads nobody has committed to calling back', async () => {
    leads = [
      lead('Scheduled', new Date(Date.now() + 2 * HOUR)),
      lead('Forgotten', null),
    ]
    wrapper = await mountList()

    await chip(wrapper, 'No reminder').trigger('click')
    expect(rowNames(wrapper)).toEqual(['Forgotten'])
  })

  it('clears when the active chip is pressed again', async () => {
    leads = [lead('Late', new Date(Date.now() - 2 * DAY)), lead('Nothing', null)]
    wrapper = await mountList()

    await chip(wrapper, 'Overdue').trigger('click')
    expect(rowNames(wrapper)).toHaveLength(1)
    await chip(wrapper, 'Overdue').trigger('click')
    expect(rowNames(wrapper)).toHaveLength(2)
  })

  it('hides a chip for a bucket nothing is in, rather than showing a zero', async () => {
    leads = [lead('Soon', new Date(Date.now() + 2 * HOUR))]
    wrapper = await mountList()

    expect(chip(wrapper, 'Due today')).toBeTruthy()
    expect(chip(wrapper, 'Overdue')).toBeUndefined()
  })
})

describe('sorting by next action', () => {
  it('puts the soonest reminder first, with unscheduled leads last', async () => {
    // Same event date on all three, so priorityScore cannot decide the order and the
    // assertion is genuinely about the reminder.
    leads = [
      lead('Nothing', null),
      lead('Week', new Date(Date.now() + 5 * DAY)),
      lead('Late', new Date(Date.now() - 2 * DAY)),
      lead('Soon', new Date(Date.now() + 2 * HOUR)),
    ]
    wrapper = await mountList()

    const header = wrapper.findAll('thead th')[2].find('button')
    await header.trigger('click')

    expect(rowNames(wrapper)).toEqual(['Late', 'Soon', 'Week', 'Nothing'])
    expect(wrapper.findAll('thead th')[2].attributes('aria-sort')).toBe('ascending')
  })

  it('turns off on a second press and reports that to assistive tech', async () => {
    leads = [lead('Soon', new Date(Date.now() + 2 * HOUR))]
    wrapper = await mountList()

    const header = () => wrapper.findAll('thead th')[2]
    await header().find('button').trigger('click')
    expect(header().attributes('aria-sort')).toBe('ascending')

    await header().find('button').trigger('click')
    expect(header().attributes('aria-sort')).toBe('none')
  })
})

describe('the event filter chips', () => {
  it('narrows on the wedding date, independently of the follow-up clock', async () => {
    leads = [
      lead('Saturday', null, { eventDate: new Date(Date.now() + 3 * DAY) }),
      lead('Months', null, { eventDate: new Date(Date.now() + 200 * DAY) }),
    ]
    wrapper = await mountList()

    // "This week" here is the urgency band, not the follow-up bucket — the two rows carry
    // visible labels precisely so this pair of chips cannot be confused.
    await chip(wrapper, 'This week').trigger('click')
    expect(rowNames(wrapper)).toEqual(['Saturday'])
  })

  it('combines with the follow-up filter rather than replacing it', async () => {
    const soon = new Date(Date.now() + 3 * DAY)
    leads = [
      lead('Both', new Date(Date.now() - 2 * DAY), { eventDate: soon }),
      lead('EventOnly', new Date(Date.now() + 2 * HOUR), { eventDate: soon }),
      lead('OverdueOnly', new Date(Date.now() - 2 * DAY), {
        eventDate: new Date(Date.now() + 200 * DAY),
      }),
    ]
    wrapper = await mountList()

    await chip(wrapper, 'Overdue').trigger('click')
    await chip(wrapper, 'This week').trigger('click')

    // The whole argument for putting the event chips on this screen: neither the Upcoming
    // events board nor the work queue can narrow both clocks at once.
    expect(rowNames(wrapper)).toEqual(['Both'])
  })

  it('keeps all three groups on one wrapping row, not three stacked ones', async () => {
    leads = [lead('X', new Date(Date.now() + 3 * DAY), {
      eventDate: new Date(Date.now() + 3 * DAY),
    })]
    wrapper = await mountList()

    // The filter block had grown to six full-width stacked rows. The groups now share a
    // single flex-wrap container, so a wide screen renders one line and a phone wraps back
    // to one group per line. Asserting the shared parent is what pins that down.
    const groups = wrapper.findAll('[role=group]')
    expect(groups.length).toBe(3)
    const parents = new Set(groups.map((g) => g.element.parentElement))
    expect(parents.size, 'the three groups must share one wrapping row').toBe(1)
  })

  it('labels every chip row, so two "week" chips are still tellable apart', async () => {
    leads = [lead('X', new Date(Date.now() + 3 * DAY), {
      eventDate: new Date(Date.now() + 3 * DAY),
    })]
    wrapper = await mountList()

    const labels = wrapper.findAll('[role=group]').map((g) => g.text())
    expect(labels.some((l) => l.startsWith('Stage'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Follow-up'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Event'))).toBe(true)
  })
})

describe('sorting by event date', () => {
  it('puts the soonest wedding first, with undated leads last', async () => {
    leads = [
      lead('NoDate', null, { eventDate: null }),
      lead('Far', null, { eventDate: new Date(Date.now() + 90 * DAY) }),
      lead('Near', null, { eventDate: new Date(Date.now() + 2 * DAY) }),
    ]
    wrapper = await mountList()

    await wrapper.findAll('thead th')[1].find('button').trigger('click')
    expect(rowNames(wrapper)).toEqual(['Near', 'Far', 'NoDate'])
  })

  it('is one sort at a time — choosing Event releases Next action', async () => {
    leads = [lead('X', new Date(Date.now() + 2 * HOUR))]
    wrapper = await mountList()

    const th = (i) => wrapper.findAll('thead th')[i]
    await th(2).find('button').trigger('click')
    expect(th(2).attributes('aria-sort')).toBe('ascending')

    await th(1).find('button').trigger('click')
    expect(th(1).attributes('aria-sort')).toBe('ascending')
    expect(th(2).attributes('aria-sort')).toBe('none')
  })
})

describe('closed leads are hidden, and the header says so', () => {
  const closed = (name, overrides = {}) =>
    lead(name, null, { leadStatus: 'closed_lost', stage: 'lost', ...overrides })

  it('hides a closed lead but offers it back, counted', async () => {
    // The exact confusion this fixes: a lost lead is visible on the Pipeline board, which
    // has a Lost column, and silently absent here.
    leads = [lead('Open', null), closed('Neema')]
    wrapper = await mountList()

    expect(rowNames(wrapper)).toEqual(['Open'])
    expect(wrapper.text()).toContain('1 closed hidden')
  })

  it('reveals them when the offer is taken, and stops offering', async () => {
    leads = [lead('Open', null), closed('Neema')]
    wrapper = await mountList()

    const reveal = wrapper.findAll('button').find((b) => b.text().includes('closed hidden'))
    await reveal.trigger('click')

    expect(rowNames(wrapper)).toEqual(expect.arrayContaining(['Open', 'Neema']))
    expect(wrapper.text()).not.toContain('closed hidden')
  })

  it('stays quiet when nothing is hidden', async () => {
    leads = [lead('Open', null)]
    wrapper = await mountList()
    expect(wrapper.text()).not.toContain('closed hidden')
  })

  it('counts only what the OTHER filters would also let through', async () => {
    // A closed lead the stage filter already excludes is not "hidden because closed", and
    // promising to reveal it would show the agent a row that never appears.
    leads = [
      lead('Open', null, { stage: 'contacted' }),
      closed('ClosedContacted', { stage: 'contacted', leadStatus: 'closed_lost' }),
      closed('ClosedNurture', { stage: 'nurture', leadStatus: 'closed_lost' }),
    ]
    wrapper = await mountList()

    await chip(wrapper, 'Contacted').trigger('click')
    expect(wrapper.text()).toContain('1 closed hidden')
    expect(wrapper.text()).not.toContain('2 closed hidden')
  })
})
