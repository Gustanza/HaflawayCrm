<script setup>
// Activity composer + timeline (upcoming tasks, then past activity grouped by month).
import { ref, reactive, computed } from 'vue'
import Icon from './Icon.vue'
import ObjectIcon from './ObjectIcon.vue'
import { store, createRecord, updateRecord, deleteRecord, logActivity, toast } from '../store.js'
import { date, dateTime, todayISO } from '../format.js'

const props = defineProps({ object: String, recordId: String })

const tab = ref('call')
const form = reactive({ subject: '', body: '', dueDate: '' })
const busy = ref(false)

function reset() {
  form.subject = ''
  form.body = ''
  form.dueDate = ''
}

// Accounts roll up activity from their contacts and opportunities.
const matches = (x) =>
  (x.relatedType === props.object && x.relatedId === props.recordId) ||
  (props.object === 'accounts' && x.accountId === props.recordId)

const tasks = computed(() => store.tasks.filter(matches))
const upcoming = computed(() =>
  tasks.value.filter((t) => t.status !== 'Completed').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
)

const past = computed(() => {
  const items = [
    ...store.activities.filter(matches).map((a) => ({ kind: a.type, at: a.createdAt, item: a })),
    ...tasks.value.filter((t) => t.status === 'Completed').map((t) => ({ kind: 'task', at: t.updatedAt, item: t })),
  ].sort((a, b) => b.at - a.at)
  const groups = []
  for (const it of items) {
    const label = new Date(it.at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
    groups.at(-1).items.push(it)
  }
  return groups
})

async function submit() {
  busy.value = true
  try {
    if (tab.value === 'task') {
      if (!form.subject.trim()) return toast('Enter a subject for the task.', 'error')
      await createRecord('tasks', {
        subject: form.subject.trim(), dueDate: form.dueDate || null, status: 'Not Started', priority: 'Normal',
        description: form.body, relatedType: props.object, relatedId: props.recordId,
      })
      toast('Task created.')
    } else if (tab.value === 'call') {
      await logActivity({ type: 'call', subject: form.subject.trim() || 'Call', body: form.body, relatedType: props.object, relatedId: props.recordId })
      toast('Call logged.')
    } else {
      if (!form.body.trim()) return toast('Write something in the note first.', 'error')
      await logActivity({ type: 'note', subject: form.subject.trim() || 'Note', body: form.body, relatedType: props.object, relatedId: props.recordId })
      toast('Note saved.')
    }
    reset()
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    busy.value = false
  }
}

async function toggleTask(t) {
  await updateRecord('tasks', t.id, { status: t.status === 'Completed' ? 'Not Started' : 'Completed' })
}

const expanded = ref(new Set())
function toggle(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

const VERB = { call: 'logged a call', note: 'added a note', system: '', task: 'had a task', sms: 'sent an SMS' }
const today = todayISO()
const isOverdue = (t) => t.dueDate && t.dueDate < today
</script>

<template>
  <div class="card">
    <div class="tabs">
      <button class="tab active">Activity</button>
    </div>

    <div class="composer">
      <div class="composer-tabs">
        <button class="ctab" :class="{ active: tab === 'call' }" @click="tab = 'call'"><ObjectIcon object="call" size="small" /> Log a Call</button>
        <button class="ctab" :class="{ active: tab === 'task' }" @click="tab = 'task'"><ObjectIcon object="tasks" size="small" /> New Task</button>
        <button class="ctab" :class="{ active: tab === 'note' }" @click="tab = 'note'"><ObjectIcon object="note" size="small" /> Note</button>
      </div>
      <form class="composer-form" @submit.prevent="submit">
        <input v-model="form.subject" class="input" :placeholder="tab === 'call' ? 'Subject (e.g. Discovery call)' : tab === 'task' ? 'Subject (e.g. Send proposal)' : 'Title'" />
        <input v-if="tab === 'task'" v-model="form.dueDate" class="input" type="date" aria-label="Due date" />
        <textarea v-model="form.body" class="textarea" rows="2" :placeholder="tab === 'note' ? 'Write a note...' : 'Comments'" />
        <div class="row">
          <span class="spacer" />
          <button class="btn btn-brand" type="submit" :disabled="busy">{{ tab === 'call' ? 'Log Call' : 'Save' }}</button>
        </div>
      </form>
    </div>

    <div class="timeline">
      <div class="section-head">Upcoming &amp; Overdue</div>
      <div v-if="!upcoming.length" class="muted small empty-line">No next steps. To get things moving, add a task.</div>
      <div v-for="t in upcoming" :key="t.id" class="item">
        <div class="rail"><ObjectIcon object="tasks" size="small" /></div>
        <div class="item-body">
          <div class="row">
            <input type="checkbox" :aria-label="'Complete ' + t.subject" @change="toggleTask(t)" />
            <RouterLink :to="`/o/tasks/${t.id}`" class="item-title truncate">{{ t.subject }}</RouterLink>
            <span class="spacer" />
            <span class="small" :class="isOverdue(t) ? 'overdue' : 'muted'">{{ t.dueDate ? date(t.dueDate) : 'No due date' }}</span>
          </div>
          <div class="muted small">{{ t.ownerName }} has an upcoming task<template v-if="object === 'accounts' && t.relatedType !== 'accounts'"> on a related record</template></div>
        </div>
      </div>

      <template v-for="g in past" :key="g.label">
        <div class="section-head">{{ g.label }}</div>
        <div v-for="{ kind, item, at } in g.items" :key="item.id" class="item">
          <div class="rail"><ObjectIcon :object="kind === 'task' ? 'tasks' : kind" size="small" /></div>
          <div class="item-body">
            <div class="row">
              <button v-if="item.body || item.description" class="btn-icon bare small" :aria-label="'Toggle details'" @click="toggle(item.id)">
                <Icon :name="expanded.has(item.id) ? 'down' : 'right'" :size="12" />
              </button>
              <input v-if="kind === 'task'" type="checkbox" checked :aria-label="'Reopen ' + item.subject" @change="toggleTask(item)" />
              <RouterLink v-if="kind === 'task'" :to="`/o/tasks/${item.id}`" class="item-title truncate done">{{ item.subject }}</RouterLink>
              <span v-else class="item-title truncate" :class="{ system: kind === 'system' }">{{ item.subject }}</span>
              <span class="spacer" />
              <span class="muted small" :title="dateTime(at)">{{ date(at) }}</span>
              <button v-if="!['task', 'system', 'sms'].includes(kind)" class="btn-icon bare small del" aria-label="Delete activity"
                @click="deleteRecord('activities', item.id)"><Icon name="delete" :size="12" /></button>
            </div>
            <div class="muted small">{{ item.ownerName }} {{ kind === 'task' ? 'completed a task' : VERB[kind] }}</div>
            <div v-if="expanded.has(item.id)" class="item-detail">{{ item.body || item.description }}</div>
          </div>
        </div>
      </template>
      <div v-if="!past.length" class="muted small empty-line">No past activity. Past meetings and completed tasks show up here.</div>
    </div>
  </div>
</template>

<style scoped>
.composer { padding: 12px 16px; border-bottom: 1px solid var(--border-light); }
.composer-tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.ctab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); cursor: pointer; }
.ctab:hover { background: var(--bg); }
.ctab.active { border-color: var(--brand); background: var(--brand-light); color: var(--brand-dark); font-weight: 600; }
.composer-form { display: flex; flex-direction: column; gap: 8px; }
.timeline { padding: 4px 16px 16px; }
.section-head { background: var(--bg); padding: 4px 12px; border-radius: var(--radius); font-weight: 700; margin: 12px 0 4px; font-size: 13px; }
.item { display: flex; gap: 12px; padding: 8px 0 8px; position: relative; }
.rail { position: relative; display: flex; flex-direction: column; align-items: center; }
.item:not(:last-child) .rail::after { content: ''; position: absolute; top: 28px; bottom: -12px; width: 2px; background: var(--border-light); }
.item-body { flex: 1; min-width: 0; }
.item-title { font-weight: 600; }
.item-title.system { font-weight: 400; }
.item-title.done { text-decoration: line-through; color: var(--text-weak); }
.item-detail { margin-top: 6px; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius); white-space: pre-wrap; background: #fafaf9; }
.overdue { color: var(--error-bright); font-weight: 600; }
.empty-line { padding: 8px 12px; }
.del { opacity: 0; }
.item:hover .del { opacity: 1; }
</style>
