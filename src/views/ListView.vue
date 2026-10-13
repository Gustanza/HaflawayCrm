<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import RecordTable from '../components/RecordTable.vue'
import KanbanBoard from '../components/KanbanBoard.vue'
import CalendarView from '../components/CalendarView.vue'
import RecordFormModal from '../components/RecordFormModal.vue'
import DeleteModal from '../components/DeleteModal.vue'
import { store } from '../store.js'
import { OBJECTS, fieldDef } from '../meta/objects.js'
import { useClickOutside } from '../useClickOutside.js'

const route = useRoute()
const router = useRouter()
const object = route.params.object
const meta = OBJECTS[object]

// Per-viewer UI preferences (list view, display mode) persist locally.
const pref = (k, d) => { try { return localStorage.getItem(`hc:${object}:${k}`) || d } catch { return d } }
const savePref = (k, v) => { try { localStorage.setItem(`hc:${object}:${k}`, v) } catch { /* storage unavailable */ } }

const viewKey = ref(route.query.view || pref('view', meta.listViews[0].key))
if (!meta.listViews.some((v) => v.key === viewKey.value)) viewKey.value = meta.listViews[0].key
const view = computed(() => meta.listViews.find((v) => v.key === viewKey.value))
const MODES = [
  { key: 'table', icon: 'table', label: 'Table' },
  ...(meta.kanban ? [{ key: 'kanban', icon: 'kanban', label: 'Kanban' }] : []),
  ...(meta.calendar ? [{ key: 'calendar', icon: 'event', label: 'Calendar' }] : []),
]
const mode = ref(route.query.mode || pref('mode', 'table'))
if (!MODES.some((m) => m.key === mode.value)) mode.value = 'table'
const sort = ref({ key: null, dir: 1 })
const filterText = ref('')

watch(viewKey, (v) => { savePref('view', v); if (route.query.view !== v) router.replace({ query: { ...route.query, view: v } }) })
watch(mode, (v) => { savePref('mode', v); if (route.query.mode !== v) router.replace({ query: { ...route.query, mode: v } }) })
// Back/Forward and links that only change the query string must update the page too.
watch(() => route.query.view, (v) => { if (v && v !== viewKey.value && meta.listViews.some((x) => x.key === v)) viewKey.value = v })
watch(() => route.query.mode, (v) => { if (v && v !== mode.value && MODES.some((x) => x.key === v)) mode.value = v })

const matchesSearch = (r, q) => !q || [meta.nameOf(r), ...meta.searchFields.map((f) => r[f])].some((v) => String(v ?? '').toLowerCase().includes(q))

// Calendar and Kanban show every stage/status themselves, so they start from all records (search still applies).
const calendarRecords = computed(() => store[object].filter((r) => matchesSearch(r, filterText.value.trim().toLowerCase())))

const records = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return store[object]
    .filter((r) => view.value.filter(r, store.user))
    .filter((r) => !q || [meta.nameOf(r), ...meta.searchFields.map((f) => r[f])].some((v) => String(v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

const sortLabel = computed(() => (sort.value.key ? fieldDef(object, sort.value.key)?.label : 'Last Modified Date'))

const viewMenu = ref(false)
const viewEl = ref(null)
useClickOutside(viewEl, () => (viewMenu.value = false))

const creating = ref(false)
const editing = ref(null)
const deleting = ref(null)
</script>

<template>
  <div class="page">
    <div class="card list-card">
      <div class="page-header">
        <ObjectIcon :object="object" />
        <div>
          <div class="eyebrow">{{ meta.plural }}</div>
          <div v-if="mode === 'calendar'" class="title">Event Calendar</div>
          <div v-else-if="mode === 'kanban'" class="title">Job Board</div>
          <div v-else ref="viewEl" class="dropdown">
            <button class="view-switch title" @click="viewMenu = !viewMenu">
              {{ view.label }} <Icon name="down" :size="14" />
            </button>
            <div v-if="viewMenu" class="menu">
              <div class="menu-heading">List Views</div>
              <button v-for="v in meta.listViews" :key="v.key" class="menu-item" :class="{ selected: v.key === viewKey }"
                @click="viewKey = v.key; viewMenu = false">
                <Icon :name="v.key === viewKey ? 'check' : 'right'" :size="12" :style="{ opacity: v.key === viewKey ? 1 : 0 }" />
                {{ v.label }}
              </button>
            </div>
          </div>
        </div>
        <span class="spacer" />
        <button class="btn" @click="creating = true">New</button>
      </div>

      <div class="toolbar">
        <span class="muted small">
          <template v-if="mode === 'calendar'">All {{ meta.plural.toLowerCase() }} · filter by status below</template>
          <template v-else-if="mode === 'kanban'">{{ calendarRecords.length }} {{ meta.plural.toLowerCase() }} · drag cards between stages</template>
          <template v-else>{{ records.length }} {{ records.length === 1 ? 'item' : 'items' }}</template>
          <template v-if="mode === 'table'"> • Sorted by {{ sortLabel }}</template>
          • Updated in real time
        </span>
        <span class="spacer" />
        <div class="list-search">
          <Icon name="search" class="list-search-icon" />
          <input v-model="filterText" class="input" placeholder="Search this list..." aria-label="Search this list" />
        </div>
        <div v-if="MODES.length > 1" class="btn-group" role="group" aria-label="Display as">
          <button v-for="m in MODES" :key="m.key" class="btn-icon" :class="{ selected: mode === m.key }" :title="m.label"
            :aria-label="'Display as ' + m.label" :aria-pressed="mode === m.key" @click="mode = m.key"><Icon :name="m.icon" /></button>
        </div>
      </div>

      <CalendarView v-if="mode === 'calendar'" :object="object" :records="calendarRecords" />
      <KanbanBoard v-else-if="mode === 'kanban'" :object="object" :records="calendarRecords" @edit="editing = $event" @delete="deleting = $event" />
      <template v-else>
        <RecordTable v-if="records.length" v-model:sort="sort" :object="object" :records="records" :columns="meta.listColumns"
          @edit="editing = $event" @delete="deleting = $event" />
        <div v-else class="empty">
          <ObjectIcon :object="object" size="large" />
          <p style="font-size: 16px; margin-top: 12px">No {{ meta.plural.toLowerCase() }} to show</p>
          <p class="muted">{{ filterText ? 'Try a different search.' : `Create your first ${meta.label.toLowerCase()} to get started.` }}</p>
          <button v-if="!filterText" class="btn btn-brand" style="margin-top: 12px" @click="creating = true">New {{ meta.label }}</button>
          <p v-if="!filterText && !store[object].length" class="muted small" style="margin-top: 12px">
            Have data in the old Haflaway CRM? <RouterLink to="/setup/import">Import it here</RouterLink>.
          </p>
        </div>
      </template>
    </div>

    <RecordFormModal v-if="creating" :object="object" @close="creating = false" @saved="(id) => router.push(`/o/${object}/${id}`)" />
    <RecordFormModal v-if="editing" :object="object" :record="editing" @close="editing = null" @saved="editing = null" />
    <DeleteModal v-if="deleting" :object="object" :record="deleting" @close="deleting = null" @deleted="deleting = null" />
  </div>
</template>

<style scoped>
.list-card { min-height: calc(100vh - 116px); }
.view-switch { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; font-size: 18px; font-weight: 700; color: var(--text); }
.view-switch:hover { color: var(--brand); }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 0 16px 12px; flex-wrap: wrap; }
.list-search { position: relative; width: 240px; }
.list-search .input { padding-left: 32px; }
.list-search-icon { position: absolute; left: 10px; top: 8px; color: var(--text-weak); }
.empty { text-align: center; padding: 64px 16px; border-top: 1px solid var(--border-light); }
</style>
