<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import { NAV_OBJECTS, OBJECTS } from '../meta/objects.js'
import { isAdmin } from '../store.js'

const route = useRoute()
const tabs = computed(() => [
  { to: '/', label: 'Home', match: (r) => r.name === 'home' },
  ...NAV_OBJECTS.map((o) => ({ to: `/o/${o}`, label: OBJECTS[o].plural, match: (r) => r.params.object === o })),
  { to: '/dashboard', label: 'Dashboards', match: (r) => r.name === 'dashboard' },
  ...(isAdmin() ? [{ to: '/setup/users', label: 'Users', match: (r) => r.name === 'users' }] : []),
])

// On narrow screens the tabs scroll sideways; keep the active one visible.
const tabsEl = ref(null)
watch(() => route.fullPath, () => nextTick(() => {
  tabsEl.value?.querySelector('.nav-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}), { immediate: true })
</script>

<template>
  <nav class="nav-bar">
    <div class="app-name">
      <span class="waffle"><Icon name="waffle" :size="18" /></span>
      <span>Sales</span>
    </div>
    <div ref="tabsEl" class="nav-tabs">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="nav-tab" :class="{ active: t.match(route) }">
        {{ t.label }}
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.nav-bar {
  height: 40px; background: var(--surface); display: flex; align-items: stretch; padding: 0 16px 0 12px;
  border-bottom: 3px solid var(--brand); box-shadow: 0 2px 2px rgba(0, 0, 0, .08);
}
.app-name { display: flex; align-items: center; gap: 12px; font-size: 18px; padding-right: 24px; white-space: nowrap; }
.waffle { color: var(--text-weak); display: flex; padding: 4px; }
.nav-tabs { display: flex; align-items: stretch; overflow-x: auto; }
.nav-tab {
  display: flex; align-items: center; padding: 0 12px; color: var(--text); font-size: 13px; white-space: nowrap;
  position: relative;
}
.nav-tab::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: transparent; }
.nav-tab:hover { background: var(--bg); text-decoration: none; color: var(--text); }
.nav-tab:hover::before { background: var(--border); }
.nav-tab.active { background: rgba(1, 118, 211, .06); font-weight: 700; }
.nav-tab.active::before { background: var(--brand); }
@media (max-width: 640px) {
  .nav-bar { padding: 0 0 0 4px; }
  .app-name { padding-right: 4px; }
  .app-name > span:last-child { display: none; }
  .nav-tabs { scrollbar-width: none; }
}
</style>
