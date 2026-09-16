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
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true, titleKey: 'auth.signIn' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { public: true, titleKey: 'auth.register.title' },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/auth/ForgotPasswordView.vue'),
    meta: { public: true, titleKey: 'auth.forgotPasswordTitle' },
  },
  {
    path: '/no-access',
    name: 'no-access',
    component: () => import('@/views/auth/NoAccessView.vue'),
    meta: { requiresAuth: true, allowUnprovisioned: true, titleKey: 'auth.noAccess.title' },
  },
  {
    path: '/',
    name: 'work-queue',
    component: () => import('@/views/WorkQueueView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.workQueue' },
  },
  {
    path: '/leads',
    name: 'leads',
    component: () => import('@/views/LeadsListView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.leads' },
  },
  {
    path: '/leads/new',
    name: 'lead-new',
    component: () => import('@/views/QuickAddLeadView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.newLead' },
  },
  {
    path: '/leads/:id',
    name: 'lead-detail',
    component: () => import('@/views/LeadDetailView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.lead' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, roles: ['admin', 'manager'], titleKey: 'nav.dashboard' },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/ForbiddenView.vue'),
    meta: { requiresAuth: true, allowUnprovisioned: true, titleKey: 'errors.forbidden' },
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
    // Already signed in and provisioned? Skip the login/register screens.
    if (
      authStore.canUseApp &&
      ['login', 'register', 'forgot-password'].includes(to.name)
    ) {
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
