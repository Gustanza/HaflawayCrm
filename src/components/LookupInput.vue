<script setup>
// Salesforce-style lookup: type to search records, pick one, shown as a removable pill.
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import ObjectIcon from './ObjectIcon.vue'
import { store } from '../store.js'
import { OBJECTS, recordName } from '../meta/objects.js'
import { searchAll } from '../search.js'
import { useClickOutside } from '../useClickOutside.js'

const props = defineProps({
  modelValue: String,
  object: String, // fixed object; omit to search all relatable objects
  objects: Array,
  id: String,
})
const emit = defineEmits(['update:modelValue', 'select'])

const q = ref('')
const open = ref(false)
const el = ref(null)
useClickOutside(el, () => (open.value = false))

const selected = computed(() => {
  if (!props.modelValue || !props.object) return null
  const r = store[props.object].find((x) => x.id === props.modelValue)
  return r ? { object: props.object, name: recordName(props.object, r) } : { object: props.object, name: '(deleted record)' }
})

const results = computed(() => {
  const objs = props.object ? [props.object] : props.objects
  if (!q.value.trim()) {
    // Show recent records when nothing is typed yet.
    return objs.flatMap((o) => store[o].map((r) => ({ object: o, record: r, name: recordName(o, r) })))
      .sort((a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0)).slice(0, 6)
  }
  return searchAll(q.value, objs).slice(0, 8)
})

function pick(hit) {
  emit('update:modelValue', hit.record.id)
  emit('select', hit)
  q.value = ''
  open.value = false
}
function clear() {
  emit('update:modelValue', null)
  emit('select', null)
}
</script>

<template>
  <div ref="el" class="lookup">
    <div v-if="selected" class="lookup-pill">
      <ObjectIcon :object="selected.object" size="small" />
      <span class="truncate">{{ selected.name }}</span>
      <button type="button" class="btn-icon bare small" aria-label="Remove" @click="clear"><Icon name="close" :size="12" /></button>
    </div>
    <template v-else>
      <input
        :id="id" v-model="q" class="input" autocomplete="off"
        :placeholder="`Search ${object ? OBJECTS[object].plural : 'records'}...`"
        @focus="open = true" @input="open = true" @keydown.esc.stop="open = false"
        @keydown.enter.prevent="q.trim() && results[0] && pick(results[0])"
      />
      <Icon name="search" class="lookup-icon" />
      <div v-if="open" class="menu lookup-menu">
        <div v-if="!q.trim() && results.length" class="menu-heading">Recent {{ object ? OBJECTS[object].plural : 'Records' }}</div>
        <button v-for="h in results" :key="h.object + h.record.id" type="button" class="menu-item" @mousedown.prevent="pick(h)">
          <ObjectIcon :object="h.object" size="small" />
          <span class="truncate">{{ h.name }}<span v-if="!object" class="muted small"> · {{ OBJECTS[h.object].label }}</span></span>
        </button>
        <div v-if="!results.length" class="menu-item muted">No results</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lookup { position: relative; }
.lookup .input { padding-right: 32px; }
.lookup-icon { position: absolute; right: 10px; top: 8px; color: var(--text-weak); pointer-events: none; }
.lookup-menu { left: 0; right: 0; max-height: 280px; overflow-y: auto; }
.lookup-pill {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 4px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--surface);
}
.lookup-pill .truncate { flex: 1; }
</style>
