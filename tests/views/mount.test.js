/**
 * Mounts every view once, against mocked Firestore/Auth (see setupFirebaseMock.js) and a
 * real, signed-in auth store. TODO.legacy.md B38: a compile check cannot catch a runtime
 * throw — a screen has previously shipped that compiled clean, returned HTTP 200, and
 * rendered nothing. Vue reports a render error to `console.error` rather than throwing out
 * of `mount()`, so that is what this suite spies on and asserts against, not just the
 * absence of a thrown exception.
 *
 * SCOPE, stated plainly: this is the "no data / empty state" pass for every screen — the
 * cheapest, highest-value net (every view renders its loading/empty state without dying).
 * It deliberately does NOT feed each screen a populated dataset: the shared Firestore mock's
 * `onSnapshot`/`getDocs` return an empty snapshot regardless of which query was built, and
 * making the mock query-aware enough to route different canned data to a lead doc vs. its
 * deals vs. its timeline (all live-subscribed in the same LeadDetailView mount) is real
 * engineering effort for one more increment of coverage beyond what this suite is for. If a
 * future defect is specifically about how a screen renders WITH rows, prefer a focused test
 * next to that screen over generalising this file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import './setupFirebaseMock.js'
import { mountView } from './mountHelper.js'

import LoginView from '@/views/auth/LoginView.vue'
import RegisterView from '@/views/auth/RegisterView.vue'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView.vue'
import NoAccessView from '@/views/auth/NoAccessView.vue'
import WorkQueueView from '@/views/WorkQueueView.vue'
import LeadsListView from '@/views/LeadsListView.vue'
import QuickAddLeadView from '@/views/QuickAddLeadView.vue'
import LeadDetailView from '@/views/LeadDetailView.vue'
import DashboardView from '@/views/DashboardView.vue'
import SettingsView from '@/views/SettingsView.vue'
import UsersView from '@/views/admin/UsersView.vue'
import SetupView from '@/views/SetupView.vue'
import ForbiddenView from '@/views/ForbiddenView.vue'
import NotFoundView from '@/views/NotFoundView.vue'

const CASES = [
  { label: 'LoginView', Component: LoginView, path: '/login', name: 'login', signedIn: { role: null } },
  { label: 'RegisterView', Component: RegisterView, path: '/register', name: 'register', signedIn: { role: null } },
  { label: 'ForgotPasswordView', Component: ForgotPasswordView, path: '/forgot-password', name: 'forgot-password', signedIn: { role: null } },
  { label: 'NoAccessView', Component: NoAccessView, path: '/no-access', name: 'no-access', signedIn: { provisioned: false } },
  { label: 'WorkQueueView', Component: WorkQueueView, path: '/', name: 'work-queue', signedIn: { role: 'agent' } },
  { label: 'LeadsListView', Component: LeadsListView, path: '/leads', name: 'leads', signedIn: { role: 'agent' } },
  { label: 'QuickAddLeadView', Component: QuickAddLeadView, path: '/leads/new', name: 'lead-new', signedIn: { role: 'agent' } },
  { label: 'LeadDetailView', Component: LeadDetailView, path: '/leads/:id', name: 'lead-detail', params: { id: 'lead-1' }, signedIn: { role: 'agent' } },
  { label: 'LeadDetailView (manager)', Component: LeadDetailView, path: '/leads/:id', name: 'lead-detail', params: { id: 'lead-1' }, signedIn: { role: 'manager' } },
  { label: 'DashboardView', Component: DashboardView, path: '/dashboard', name: 'dashboard', signedIn: { role: 'manager' } },
  { label: 'DashboardView (admin)', Component: DashboardView, path: '/dashboard', name: 'dashboard', signedIn: { role: 'admin' } },
  { label: 'SettingsView', Component: SettingsView, path: '/settings', name: 'settings', signedIn: { role: 'agent' } },
  { label: 'UsersView', Component: UsersView, path: '/admin/users', name: 'admin-users', signedIn: { role: 'admin' } },
  { label: 'SetupView', Component: SetupView, path: '/setup', name: 'setup', signedIn: { role: 'admin' } },
  { label: 'SetupView (unprovisioned)', Component: SetupView, path: '/setup', name: 'setup', signedIn: { provisioned: false } },
  { label: 'ForbiddenView', Component: ForbiddenView, path: '/forbidden', name: 'forbidden', signedIn: { role: 'agent' } },
  { label: 'NotFoundView', Component: NotFoundView, path: '/nope', name: 'not-found', signedIn: { role: 'agent' } },
]

let consoleErrorSpy

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('every view mounts without a render error', () => {
  for (const testCase of CASES) {
    it(`${testCase.label} mounts cleanly with no data`, async () => {
      const { wrapper } = await mountView(testCase.Component, testCase)

      expect(wrapper.exists()).toBe(true)
      // The root element must actually have rendered something — an empty comment node
      // (Vue's placeholder for a component whose template threw) is the exact failure
      // mode B38 found and a snapshot-only assertion would miss.
      expect(wrapper.html().trim().length).toBeGreaterThan(0)

      const rendererErrors = consoleErrorSpy.mock.calls.filter(([first]) =>
        typeof first === 'string' && /error/i.test(first) || first instanceof Error,
      )
      expect(
        rendererErrors,
        `console.error was called while mounting ${testCase.label}:\n` +
          rendererErrors.map((args) => args.map(String).join(' ')).join('\n'),
      ).toHaveLength(0)
    })
  }
})
