/**
 * Routing and route guards.
 *
 * Guards are convenience, not security (TODO.md P10) — firestore.rules is what actually
 * protects data. A guard exists so a user does not land on a screen that will only show
 * them permission errors.
 *
 * Every view is lazily imported so the initial bundle stays inside the 250 KB budget
 * (TODO.md §15).
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import i18n from '@/i18n.js'

const routes = [
  // ---- Unauthenticated ----
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true, layout: 'auth', titleKey: 'auth.signIn' },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/auth/ForgotPasswordView.vue'),
    meta: { public: true, layout: 'auth', titleKey: 'auth.forgotPassword' },
  },
  {
    // A real staff member who has signed in but whose claims are not provisioned yet.
    path: '/no-access',
    name: 'no-access',
    component: () => import('@/views/auth/NoAccessView.vue'),
    meta: {
      requiresAuth: true,
      allowUnprovisioned: true,
      layout: 'auth',
      titleKey: 'auth.noAccess.title',
    },
  },

  // ---- The app ----
  {
    path: '/',
    redirect: { name: 'work-queue' },
  },
  {
    path: '/queue',
    name: 'work-queue',
    component: () => import('@/views/tasks/WorkQueueView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.workQueue' },
  },
  {
    path: '/leads',
    name: 'leads',
    component: () => import('@/views/leads/LeadListView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.leads' },
  },
  {
    path: '/leads/new',
    name: 'lead-new',
    component: () => import('@/views/leads/LeadQuickAddView.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'manager', 'agent'], titleKey: 'nav.newLead' },
  },
  {
    path: '/leads/:id',
    name: 'lead-detail',
    component: () => import('@/views/leads/LeadDetailView.vue'),
    props: true,
    meta: { requiresAuth: true, titleKey: 'nav.lead' },
  },
  {
    path: '/pipeline',
    name: 'pipeline',
    component: () => import('@/views/leads/PipelineView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['admin', 'manager', 'finance', 'viewer'],
      titleKey: 'nav.pipeline',
    },
  },
  {
    path: '/urgency',
    name: 'urgency',
    component: () => import('@/views/leads/UrgencyBoardView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.urgency' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.settings' },
  },

  // ---- Money. Agents must never land here (§7.1) ----
  {
    path: '/campaigns',
    name: 'campaigns',
    component: () => import('@/views/finance/CampaignsView.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'manager', 'finance'], titleKey: 'nav.campaigns' },
  },
  {
    path: '/expenses',
    name: 'expenses',
    component: () => import('@/views/finance/ExpensesView.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'finance'], titleKey: 'nav.expenses' },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: () => import('@/views/analytics/DashboardView.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'manager', 'finance', 'viewer'], titleKey: 'nav.analytics' },
  },

  // ---- Admin ----
  {
    /**
     * Setup is the ONE authenticated route that must work without a role.
     * `allowUnprovisioned` is what lets a console-created account reach the first-admin
     * claim instead of being bounced to /no-access forever. The screen itself decides
     * what to show; there is no `roles` gate here on purpose.
     */
    path: '/setup',
    name: 'setup',
    component: () => import('@/views/admin/SetupView.vue'),
    meta: { requiresAuth: true, allowUnprovisioned: true, titleKey: 'setup.title' },
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/admin/UsersView.vue'),
    meta: { requiresAuth: true, roles: ['admin'], titleKey: 'nav.users' },
  },

  // ---- Fallbacks ----
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/ForbiddenView.vue'),
    meta: { requiresAuth: true, titleKey: 'errors.forbidden' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, titleKey: 'errors.notFound' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    return saved ?? { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // Wait for Firebase to resolve the session, so a refresh on a deep link does not
  // bounce the user to /login for a fraction of a second before restoring them.
  if (authStore.initialising) {
    await authStore.init()
  }

  if (to.meta.public) {
    // Already signed in and provisioned? Skip the login screen.
    if (authStore.canUseApp && (to.name === 'login' || to.name === 'forgot-password')) {
      return { name: 'work-queue' }
    }
    return true
  }

  if (to.meta.requiresAuth && !authStore.isSignedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Signed in but not usable: no role claim yet, or deactivated.
  if (!authStore.canUseApp && !to.meta.allowUnprovisioned) {
    return { name: 'no-access' }
  }

  if (to.meta.roles && !to.meta.roles.includes(authStore.role)) {
    return { name: 'forbidden' }
  }

  return true
})

/**
 * A deploy while the app is open evicts the old hashed chunks, so a lazy route import in
 * an already-loaded page 404s. Vue Router swallows that: no spinner, no error, the tab
 * simply stays put, and the agent concludes the app is broken.
 *
 * One reload picks up the new build. Guarded against a loop by only reloading once.
 */
let reloadedForStaleChunk = false

router.onError((error) => {
  const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
    error?.message ?? '',
  )
  if (stale && !reloadedForStaleChunk) {
    reloadedForStaleChunk = true
    window.location.reload()
  }
})

/**
 * After navigation: name the page, and move focus to it.
 *
 * Without the focus move, a keyboard or screen-reader user re-tabs through the whole nav
 * on every route change and is never told the page changed — the classic SPA failure.
 */
router.afterEach((to) => {
  const { t } = i18n.global
  const title = to.meta.titleKey ? `${t(to.meta.titleKey)} · ${t('app.name')}` : t('app.name')
  document.title = title

  // Wait for the incoming view to mount before looking for its heading.
  requestAnimationFrame(() => {
    const target = document.querySelector('main h1') ?? document.querySelector('main')
    if (!target) return
    // tabindex="-1" makes a non-interactive element focusable without adding it to the
    // tab order; removing it afterwards keeps the DOM clean.
    target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
  })
})

export default router
