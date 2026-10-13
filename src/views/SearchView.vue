<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ObjectIcon from '../components/ObjectIcon.vue'
import RecordTable from '../components/RecordTable.vue'
import { searchAll } from '../search.js'
import { OBJECTS, NAV_OBJECTS } from '../meta/objects.js'

const route = useRoute()
const q = computed(() => String(route.query.q || ''))
const hits = computed(() => searchAll(q.value))
const filter = ref('all')
watch(q, () => (filter.value = 'all'))

const groups = computed(() =>
  NAV_OBJECTS.map((o) => ({ object: o, records: hits.value.filter((h) => h.object === o).map((h) => h.record) }))
    .filter((g) => g.records.length && (filter.value === 'all' || filter.value === g.object)),
)
const count = (o) => hits.value.filter((h) => h.object === o).length
</script>

<template>
  <div class="page search-page">
    <aside class="card side">
      <div class="side-title">Search Results</div>
      <button class="side-item" :class="{ active: filter === 'all' }" @click="filter = 'all'">Top Results <span>{{ hits.length }}</span></button>
      <button v-for="o in NAV_OBJECTS" :key="o" class="side-item" :class="{ active: filter === o }" :disabled="!count(o)" @click="filter = o">
        {{ OBJECTS[o].plural }} <span>{{ count(o) }}</span>
      </button>
    </aside>
    <div class="stack">
      <div v-if="!hits.length" class="card card-empty" style="padding: 48px">
        <p style="font-size: 16px">Don't see what you're looking for?</p>
        <p class="muted">No results for "{{ q }}". Check the spelling or try a shorter search.</p>
      </div>
      <div v-for="g in groups" :key="g.object" class="card">
        <div class="card-header">
          <ObjectIcon :object="g.object" size="small" />
          <span class="card-title">{{ OBJECTS[g.object].plural }}</span>
          <span class="muted small">{{ g.records.length }} {{ g.records.length === 1 ? 'Result' : 'Results' }}</span>
        </div>
        <RecordTable :object="g.object" :records="g.records" :columns="OBJECTS[g.object].listColumns" :show-index="false" :actions="false" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-page { display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: start; }
.side { padding: 8px 0; }
.side-title { font-weight: 700; padding: 8px 16px; font-size: 14px; }
.side-item { display: flex; justify-content: space-between; width: 100%; padding: 8px 16px; background: none; border: 0; border-left: 3px solid transparent; cursor: pointer; text-align: left; }
.side-item:hover:not(:disabled) { background: var(--bg); }
.side-item:disabled { color: #aeaeae; cursor: default; }
.side-item.active { border-left-color: var(--brand); background: var(--brand-light); font-weight: 700; }
.side-item span { color: var(--text-weak); font-weight: 400; }
@media (max-width: 800px) { .search-page { grid-template-columns: 1fr; } }
</style>
