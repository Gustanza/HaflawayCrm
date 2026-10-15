import { createRouter, createWebHistory } from 'vue-router'
import { store, authReady, roleReady } from './store.js'
import { OBJECTS } from './meta/objects.js'

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
  { path: '/setup/users', name: 'users', component: () => import('./views/UsersView.vue'), meta: { admin: true } },
  { path: '/setup/import', name: 'import', component: () => import('./views/ImportView.vue'), meta: { admin: true } },
  { path: '/o/:object', name: 'list', component: () => import('./views/ListView.vue'), meta: { object: true } },
  { path: '/o/:object/:id', name: 'record', component: () => import('./views/RecordView.vue'), meta: { object: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  await authReady
  if (to.meta.object && !OBJECTS[to.params.object]) return '/'
  if (!to.meta.public && !store.user) return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  if (to.name === 'login' && store.user) return '/'
  if (to.meta.admin) {
    await roleReady()
    if (store.user?.role !== 'admin') return '/'
  }
})
