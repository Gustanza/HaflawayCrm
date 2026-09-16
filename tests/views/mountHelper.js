/**
 * Shared harness for the view-mount suite. See setupFirebaseMock.js for what backs Firestore.
 */
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n.js'
import { useAuthStore } from '@/stores/auth.js'

/**
 * Put the (mocked) auth store into a signed-in, provisioned state — the state every
 * authenticated view assumes, since router guards (not component logic) are what would
 * normally keep an unprovisioned user away from it. Pass `null` for `role` to leave the
 * store fully signed-out, for the public auth screens.
 */
export function signIn({
  role = 'agent', orgId = 'org1', teamId = 'team-a', uid = 'u1', provisioned = true,
} = {}) {
  const auth = useAuthStore()
  auth.initialising = false
  if (role === null) return auth

  auth.user = { uid, email: `${uid}@haflaway.com` }
  auth.claims = provisioned ? { role, orgId, teamId, active: true } : null
  auth.profile = provisioned
    ? { id: uid, displayName: 'Test User', locale: 'sw', role, orgId, teamId, isActive: true }
    : null
  return auth
}

/**
 * Every route NAME the app's real router declares (src/router/index.js), so a `<RouterLink
 * :to="{ name: '...' }">` inside whichever view is under test can resolve its `href` even
 * though that OTHER view is never actually rendered here. `useLink()` calls `router.resolve()`
 * eagerly during setup, so a route table missing a name throws "No match for" — not a defect
 * in the component under test, just an artefact of this harness only caring about one route
 * at a time. A trivial stub component is enough; nothing here ever navigates to it.
 */
const ALL_ROUTE_NAMES = [
  'login', 'register', 'forgot-password', 'no-access',
  'work-queue', 'leads', 'lead-new', 'lead-detail',
  'dashboard', 'settings', 'admin-users', 'setup',
  'forbidden', 'not-found',
]
const Stub = { template: '<div />' }

/**
 * Mount a view component with a real (but route-guard-free) router, real Pinia, real i18n.
 * Guards live in src/router/index.js and are a routing concern, not a component-mount
 * concern — this harness intentionally does not exercise them.
 */
export async function mountView(Component, { path = '/', name = 'test', params = {}, signedIn = {} } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (signedIn !== false) signIn(signedIn)

  const routes = ALL_ROUTE_NAMES.map((routeName) =>
    routeName === name
      ? { path, name, component: Component }
      : { path: `/__stub/${routeName}`, name: routeName, component: Stub },
  )
  // The route under test might not be one of the named app routes (it always is, in
  // practice) — fall back to appending it so `router.push` below always has somewhere to go.
  if (!routes.some((r) => r.name === name)) routes.push({ path, name, component: Component })

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push({ name, params })
  await router.isReady()

  const wrapper = mount(Component, {
    global: { plugins: [pinia, router, i18n] },
  })
  await flushMicrotasks()
  return { wrapper, pinia, router }
}

/** Let pending promises (Firestore mock resolutions, watchers) settle before asserting. */
export async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
