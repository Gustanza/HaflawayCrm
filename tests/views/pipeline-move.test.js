/**
 * PipelineView.vue's kanban columns were converted from a stack of `<article>` cards to a
 * compact `.data-table` per column (the tabular-redesign pass). Drag-and-drop and
 * tap-to-move are the whole point of this screen, so this test proves both still work
 * against the new `<tr draggable>` markup exactly as they did against the old
 * `<article draggable>` cards — same `dragging`/`moveTarget` refs, same `changeStage` call.
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

const lead = {
  id: 'l1',
  displayName: 'Draggable Lead',
  ownerId: 'u-agent-1',
  stage: 'contacted',
  leadStatus: 'open',
  primaryPhoneNormalized: '+255712345678',
  eventDate: new Date(Date.now() + 10 * 86400000),
  eventType: 'harusi',
  dealValueMinor: 500000,
  currency: 'TZS',
}

let items
const changeStageSpy = vi.fn(async () => {})

vi.mock('@/composables/useCollection.js', () => ({
  useCollection: () => ({
    items: computed(() => items),
    loading: ref(false),
    loadingMore: ref(false),
    loaded: ref(true),
    error: ref(null),
    isEmpty: computed(() => items.length === 0),
    fromCache: ref(false),
    hasMore: computed(() => false),
    load: () => {},
    loadMore: () => {},
    stop: () => {},
  }),
}))

vi.mock('@/services/leads.service.js', () => ({
  changeStage: (...args) => changeStageSpy(...args),
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
    uid: 'u-admin', role: 'admin', orgId: 'haflaway', teamId: null,
    displayName: 'Admin',
    can: { createLead: true, viewAllLeads: true, viewTeamLeads: false },
  }),
}))

const uiSuccess = vi.fn()
const uiError = vi.fn()
const uiWarn = vi.fn()
vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ trackWrite: vi.fn(), success: uiSuccess, error: uiError, warn: uiWarn }),
}))

const i18n = createI18n({
  legacy: false, locale: 'en', fallbackLocale: 'sw',
  messages: { sw, en }, missingWarn: false, fallbackWarn: false,
})

const RouterLink = { props: ['to'], template: '<a><slot /></a>' }

async function mountBoard() {
  const { default: PipelineView } = await import('../../src/views/leads/PipelineView.vue')
  return mount(PipelineView, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink, RouterView: true },
      mocks: {
        $route: { name: 'pipeline', params: {}, query: {} },
        $router: { push: () => {}, replace: () => {}, back: () => {} },
      },
    },
  })
}

let wrapper

beforeEach(() => {
  setActivePinia(createPinia())
  changeStageSpy.mockClear()
  uiSuccess.mockClear()
  uiError.mockClear()
  uiWarn.mockClear()
  items = [lead]
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('PipelineView — the table-row rewrite keeps drag-and-drop and tap-to-move working', () => {
  it('renders each lead as a draggable table row inside its stage column', async () => {
    wrapper = await mountBoard()
    const row = wrapper.findAll('tbody tr').find((r) => r.text().includes('Draggable Lead'))
    expect(row, 'lead row not found').toBeTruthy()
    expect(row.attributes('draggable')).toBe('true')
  })

  it('dropping a dragged row on another column calls changeStage with the new stage', async () => {
    wrapper = await mountBoard()

    const row = wrapper.findAll('tbody tr').find((r) => r.text().includes('Draggable Lead'))
    await row.trigger('dragstart')

    // The lead starts in "contacted"; drop it on the "nurture" column section — chosen
    // because it has no STAGE_REQUIREMENTS, unlike "qualified" (which needs BEDS fields
    // this test lead does not have and would fail validateTransition before ever reaching
    // changeStage).
    const targetSection = wrapper
      .findAll('section')
      .find((s) => s.attributes('aria-labelledby') === 'col-nurture')
    expect(targetSection, 'nurture column not found').toBeTruthy()

    await targetSection.trigger('drop')

    expect(changeStageSpy).toHaveBeenCalledTimes(1)
    expect(changeStageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ toStage: 'nurture', lead: expect.objectContaining({ id: 'l1' }) }),
    )
  })

  it('tapping the move icon opens the tap-to-move sheet, and choosing a stage calls changeStage', async () => {
    wrapper = await mountBoard()

    const moveButton = wrapper.find(`[aria-label="Move Draggable Lead"]`)
    expect(moveButton.exists(), 'move icon button not found').toBe(true)
    await moveButton.trigger('click')

    // The sheet renders one button per legal next stage.
    const sheet = wrapper.find('[role="dialog"]')
    expect(sheet.exists()).toBe(true)

    const stageButton = sheet.findAll('button').find((b) => b.text() === 'Nurture')
    expect(stageButton, 'nurture option not found in sheet').toBeTruthy()
    await stageButton.trigger('click')

    expect(changeStageSpy).toHaveBeenCalledTimes(1)
    expect(changeStageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ toStage: 'nurture', lead: expect.objectContaining({ id: 'l1' }) }),
    )
  })
})
