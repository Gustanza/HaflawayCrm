<script setup>
// Salesforce "Path": chevron stages with Mark Complete / Mark as Current actions.
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import { OBJECTS, isClosedStage, WON_STAGE, LOST_STAGE } from '../meta/objects.js'
import { updateRecord, toast } from '../store.js'
import { celebrate } from '../confetti.js'

const props = defineProps({ object: String, record: Object })
const emit = defineEmits(['convert'])

const meta = computed(() => OBJECTS[props.object])
const cfg = computed(() => meta.value.path)
const fieldLabel = computed(() => meta.value.fields.find((f) => f.key === cfg.value.field).label.replace('Lead ', ''))
const current = computed(() => props.record[cfg.value.field])
const isOpp = computed(() => props.object === 'opportunities')
const last = computed(() => cfg.value.stages.length - 1)

const currentIndex = computed(() => {
  if (isOpp.value && isClosedStage(current.value)) return last.value
  return cfg.value.stages.indexOf(current.value)
})
const lost = computed(() => current.value === LOST_STAGE)

const steps = computed(() =>
  cfg.value.stages.map((s, i) => {
    let label = s
    if (isOpp.value && i === last.value) label = isClosedStage(current.value) ? current.value : cfg.value.closedLabel
    let state = 'incomplete'
    if (i < currentIndex.value) state = 'complete'
    else if (i === currentIndex.value) state = i === last.value ? (lost.value ? 'lost' : 'won') : 'current'
    return { value: s, label, state, i }
  }),
)

const selected = ref(null)
const selectedIndex = computed(() => (selected.value === null ? currentIndex.value : selected.value))
const finished = computed(() => currentIndex.value === last.value)
// A converted lead is final: its links to the new account/contact/job must not be orphaned.
const locked = computed(() => props.object === 'leads' && current.value === 'Converted')

const buttonLabel = computed(() => {
  if (selected.value !== null && selected.value !== currentIndex.value) {
    if (selected.value === last.value) return isOpp.value ? 'Finish Job' : props.object === 'leads' ? 'Convert Lead' : `Mark as Current ${fieldLabel.value}`
    return `Mark as Current ${fieldLabel.value}`
  }
  if (currentIndex.value + 1 === last.value) {
    return isOpp.value ? 'Finish Job' : props.object === 'leads' ? 'Convert Lead' : `Mark ${fieldLabel.value} as Complete`
  }
  return `Mark ${fieldLabel.value} as Complete`
})

const closeOpen = ref(false)
const closeChoice = ref(WON_STAGE)
const busy = ref(false)

async function setStage(value) {
  busy.value = true
  try {
    await updateRecord(props.object, props.record.id, { [cfg.value.field]: value })
    toast(`${fieldLabel.value} changed successfully.`)
    if (value === WON_STAGE) celebrate()
    selected.value = null
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    busy.value = false
  }
}

function goTo(index) {
  if (index === last.value && isOpp.value) {
    closeChoice.value = WON_STAGE
    closeOpen.value = true
  } else if (index === last.value && props.object === 'leads') {
    emit('convert')
  } else {
    setStage(cfg.value.stages[index])
  }
}

function action() {
  if (selected.value !== null && selected.value !== currentIndex.value) goTo(selected.value)
  else goTo(Math.min(currentIndex.value + 1, last.value))
}

async function confirmClose() {
  closeOpen.value = false
  await setStage(closeChoice.value)
}
</script>

<template>
  <div class="card path-card">
    <div class="path">
      <ol class="path-track">
        <li v-for="s in steps" :key="s.value">
          <button
            class="path-step" :class="[s.state, { selected: selected === s.i && s.i !== currentIndex }]"
            :title="s.label" :disabled="locked" @click="selected = s.i === currentIndex ? null : s.i"
          >
            <span class="path-label">{{ s.label }}</span>
            <span v-if="s.state === 'complete'" class="path-check"><Icon name="check" :size="14" /></span>
          </button>
        </li>
      </ol>
      <button
        v-if="!locked && ((!finished && currentIndex !== -1) || (selected !== null && selected !== currentIndex))" class="btn btn-brand path-action"
        :disabled="busy" @click="action"
      >
        <Icon name="check" /> {{ buttonLabel }}
      </button>
    </div>
    <div v-if="currentIndex === -1" class="path-note muted small">
      Current {{ fieldLabel.toLowerCase() }}: <strong>{{ current || 'None' }}</strong> — select a step above to move this record back onto the path.
    </div>

    <Modal v-if="closeOpen" small title="Finish This Job" @close="closeOpen = false">
      <div class="form-element">
        <label for="close-stage"><abbr class="required">*</abbr>Stage</label>
        <select id="close-stage" v-model="closeChoice" class="select">
          <option :value="WON_STAGE">{{ WON_STAGE }} (job delivered)</option>
          <option :value="LOST_STAGE">{{ LOST_STAGE }} (client cancelled / went elsewhere)</option>
        </select>
      </div>
      <template #footer>
        <button class="btn" @click="closeOpen = false">Cancel</button>
        <button class="btn btn-brand" @click="confirmClose">Save</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.path-card { padding: 12px 16px; }
.path { display: flex; gap: 16px; align-items: center; }
.path-track { flex: 1; display: flex; list-style: none; margin: 0; padding: 0; gap: 0; min-width: 0; border-radius: 16px; overflow: hidden; }
.path-track li { flex: 1; min-width: 0; margin-left: -9px; }
.path-track li:first-child { margin-left: 0; }
.path-step {
  position: relative; width: 100%; height: 32px; border: 0; cursor: pointer; color: var(--text);
  background: var(--path-incomplete); font-size: 13px; padding: 0 18px 0 22px;
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%);
  display: flex; align-items: center; justify-content: center; transition: background .15s;
}
.path-track li:first-child .path-step { clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%); }
.path-track li:last-child .path-step { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%); }
.path-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path-step:hover { background: #dddbda; }
.path-step:disabled { cursor: default; }
.path-step.complete { background: var(--success-bright); color: #fff; }
.path-step.complete:hover { background: var(--success); }
.path-step.complete .path-label { display: none; }
.path-step.complete:hover .path-label { display: inline; }
.path-step.complete:hover .path-check { display: none; }
.path-step.current { background: var(--brand-dark); color: #fff; font-weight: 600; }
.path-step.won { background: var(--success-bright); color: #fff; font-weight: 600; }
.path-step.lost { background: var(--error-bright); color: #fff; font-weight: 600; }
.path-step.selected { background: var(--brand); color: #fff; }
.path-action { flex-shrink: 0; }
.path-note { margin-top: 8px; }
@media (max-width: 800px) { .path { flex-direction: column; align-items: stretch; } }
</style>
