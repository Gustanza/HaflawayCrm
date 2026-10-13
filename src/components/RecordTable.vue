<script setup>
// Sortable record table used by list views, related lists and search results.
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import FieldValue from './FieldValue.vue'
import RowActions from './RowActions.vue'
import { fieldDef, recordName } from '../meta/objects.js'
import { nameOf, updateRecord, toast } from '../store.js'

const props = defineProps({
  object: String,
  records: Array,
  columns: Array,
  showIndex: { type: Boolean, default: true },
  actions: { type: Boolean, default: true },
  sort: Object, // optional v-model:sort { key, dir }
})
const emit = defineEmits(['edit', 'delete', 'update:sort'])

const localSort = ref({ key: null, dir: 1 })
const sortState = computed(() => props.sort || localSort.value)

function sortValue(r, key) {
  const def = fieldDef(props.object, key)
  if (!def) return r[key]
  if (def.type === 'name') return recordName(props.object, r).toLowerCase()
  if (def.type === 'lookup') return nameOf(def.object, r[key]).toLowerCase()
  if (def.type === 'related') return r.relatedId ? nameOf(r.relatedType, r.relatedId).toLowerCase() : ''
  const v = r[key]
  return typeof v === 'string' ? v.toLowerCase() : v
}

const sorted = computed(() => {
  const { key, dir } = sortState.value
  if (!key) return props.records
  return [...props.records].sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key)
    if (va == null || va === '') return 1
    if (vb == null || vb === '') return -1
    return va < vb ? -dir : va > vb ? dir : 0
  })
})

function toggleSort(key) {
  const s = sortState.value
  const next = { key, dir: s.key === key ? -s.dir : 1 }
  if (props.sort) emit('update:sort', next)
  else localSort.value = next
}

const isNum = (key) => ['currency', 'percent', 'number'].includes(fieldDef(props.object, key)?.type)

async function toggleComplete(r) {
  const done = r.status !== 'Completed'
  await updateRecord('tasks', r.id, { status: done ? 'Completed' : 'Not Started' })
  if (done) toast(`Task "${r.subject}" was completed.`)
}
</script>

<template>
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th v-if="showIndex" class="col-index" />
          <th v-if="object === 'tasks'" class="col-check"><span class="sr">Done</span></th>
          <th v-for="c in columns" :key="c" class="sortable" :class="{ num: isNum(c) }" @click="toggleSort(c)">
            {{ fieldDef(object, c)?.label }}
            <Icon v-if="sortState.key === c" name="down" :size="12"
              :style="{ transform: sortState.dir === 1 ? 'rotate(180deg)' : '' }" />
          </th>
          <th v-if="actions" class="col-action" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in sorted" :key="r.id">
          <td v-if="showIndex" class="col-index">{{ i + 1 }}</td>
          <td v-if="object === 'tasks'" class="col-check">
            <input type="checkbox" :checked="r.status === 'Completed'" :aria-label="'Complete ' + r.subject" @change="toggleComplete(r)" />
          </td>
          <td v-for="(c, ci) in columns" :key="c" class="truncate" :class="{ num: isNum(c), done: object === 'tasks' && ci === 0 && r.status === 'Completed' }">
            <FieldValue :object="object" :record="r" :field="c" :link="ci === 0" />
          </td>
          <td v-if="actions" class="col-action">
            <RowActions @edit="emit('edit', r)" @delete="emit('delete', r)" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.done :deep(a) { text-decoration: line-through; color: var(--text-weak); }
</style>
