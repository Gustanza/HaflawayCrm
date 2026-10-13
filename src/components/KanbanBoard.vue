<script setup>
// Drag-and-drop board grouped by a picklist field (e.g. Opportunity Stage).
import { ref, computed } from 'vue'
import { OBJECTS, recordName, WON_STAGE, owes } from '../meta/objects.js'
import { celebrate } from '../confetti.js'
import { nameOf, updateRecord, toast } from '../store.js'
import { money, date } from '../format.js'
import RowActions from './RowActions.vue'

const props = defineProps({ object: String, records: Array })
const emit = defineEmits(['edit', 'delete'])

const cfg = computed(() => OBJECTS[props.object].kanban)
const columns = computed(() =>
  cfg.value.stages.map((stage) => {
    const items = props.records.filter((r) => r[cfg.value.field] === stage)
    return { stage, items, total: items.reduce((s, r) => s + (Number(r[cfg.value.sumField]) || 0), 0) }
  }),
)

const dragging = ref(null)
const over = ref(null)

async function drop(stage) {
  const r = dragging.value
  over.value = null
  dragging.value = null
  if (!r || r[cfg.value.field] === stage) return
  try {
    await updateRecord(props.object, r.id, { [cfg.value.field]: stage })
    toast(`"${recordName(props.object, r)}" moved to ${stage}.`)
    if (stage === WON_STAGE) celebrate()
  } catch (e) {
    toast(e.message, 'error')
  }
}
</script>

<template>
  <div class="board">
    <div
      v-for="col in columns" :key="col.stage" class="column" :class="{ over: over === col.stage }"
      @dragover.prevent="over = col.stage" @dragleave.self="over = null" @drop.prevent="drop(col.stage)"
    >
      <div class="col-header">
        <div class="col-title truncate">{{ col.stage }} <span class="muted">({{ col.items.length }})</span></div>
        <div class="col-total">{{ money(col.total) }}</div>
      </div>
      <div class="col-body">
        <div
          v-for="r in col.items" :key="r.id" class="kcard" draggable="true"
          @dragstart="dragging = r" @dragend="dragging = null; over = null"
        >
          <div class="row">
            <RouterLink :to="`/o/${object}/${r.id}`" class="kcard-title truncate">{{ recordName(object, r) }}</RouterLink>
            <span class="spacer" />
            <RowActions @edit="emit('edit', r)" @delete="emit('delete', r)" />
          </div>
          <div v-if="r.service" class="kline truncate"><span class="muted">Service:</span> {{ r.service }}</div>
          <div v-if="r.accountId" class="kline truncate"><span class="muted">Client:</span> {{ nameOf('accounts', r.accountId) }}</div>
          <div class="kline"><span class="muted">Price:</span> {{ money(r.amount) || '—' }}
            <span v-if="owes(r)" class="owed"> · owes {{ money(r.balance) }}</span></div>
          <div class="kline"><span class="muted">Deliver by:</span> {{ date(r.closeDate) }}</div>
        </div>
        <div v-if="!col.items.length" class="col-empty">Drag records here</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board { display: flex; gap: 8px; overflow-x: auto; padding: 0 16px 16px; min-height: 400px; }
.column { flex: 1 1 0; min-width: 160px; max-width: 300px; background: var(--bg); border-radius: var(--radius); display: flex; flex-direction: column; transition: background .1s; }
.column.over { background: #d8e6fe; }
.col-header {
  padding: 8px 12px; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius) var(--radius) 0 0;
  position: relative; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%);
}
.col-title { font-weight: 700; font-size: 13px; }
.col-total { font-size: 16px; font-weight: 300; }
.col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.kcard { min-width: 0; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); padding: 8px 10px; box-shadow: var(--shadow); cursor: grab; }
.kcard:active { cursor: grabbing; }
.kcard-title { font-weight: 600; }
.kline { font-size: 12px; margin-top: 2px; }
.owed { color: var(--error-bright); font-weight: 600; }
.col-empty { color: var(--text-weak); font-size: 12px; text-align: center; padding: 16px 0; border: 1px dashed var(--border); border-radius: var(--radius); }
</style>
