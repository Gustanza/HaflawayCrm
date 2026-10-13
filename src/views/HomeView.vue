<script setup>
import { ref, computed } from 'vue'
import Icon from '../components/Icon.vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import RecordFormModal from '../components/RecordFormModal.vue'
import { store, updateRecord, nameOf, toast } from '../store.js'
import { OBJECTS, NAV_OBJECTS, recordName } from '../meta/objects.js'
import { useMetrics } from '../metrics.js'
import { money, date, timeAgo, todayISO } from '../format.js'

const scope = ref('mine')
const m = useMetrics(scope)

const hour = new Date().getHours()
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
const firstName = computed(() => store.user.name.split(' ')[0])

const today = todayISO()
const myTasks = computed(() =>
  store.tasks
    .filter((t) => t.ownerId === store.user.uid && t.status !== 'Completed' && (!t.dueDate || t.dueDate <= today))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 8),
)
const upcomingCount = computed(() => store.tasks.filter((t) => t.ownerId === store.user.uid && t.status !== 'Completed' && t.dueDate > today).length)

async function complete(t) {
  await updateRecord('tasks', t.id, { status: 'Completed' })
  toast(`Task "${t.subject}" was completed.`)
}

const recent = computed(() =>
  NAV_OBJECTS.flatMap((o) => store[o].map((r) => ({ object: o, r })))
    .sort((a, b) => (b.r.updatedAt || 0) - (a.r.updatedAt || 0))
    .slice(0, 8),
)

// "Assistant" insights, like Lightning's Home assistant card.
const insights = computed(() => {
  const list = []
  const overdue = store.tasks.filter((t) => t.ownerId === store.user.uid && t.status !== 'Completed' && t.dueDate && t.dueDate < today)
  if (overdue.length) list.push({ icon: 'tasks', text: `You have ${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'}`, to: '/o/tasks?view=overdue' })
  for (const o of m.closingSoon.value.slice(0, 3)) {
    list.push({ icon: 'opportunities', text: o.overdue ? `"${o.name}" is past its delivery date` : `"${o.name}" must be delivered by ${date(o.closeDate)}`, to: `/o/opportunities/${o.id}` })
  }
  const owing = m.unpaid.value
  if (owing.length) list.push({ icon: 'accounts', text: `${owing.length} ${owing.length === 1 ? 'client owes' : 'clients owe'} ${money(m.outstanding.value)} in total`, to: '/o/opportunities?view=balance' })
  const newLeads = store.leads.filter((l) => l.status === 'New' && l.ownerId === store.user.uid)
  if (newLeads.length) list.push({ icon: 'leads', text: `${newLeads.length} new ${newLeads.length === 1 ? 'lead hasn\'t' : 'leads haven\'t'} been contacted`, to: '/o/leads?view=mine' })
  return list
})

const goal = ref(Number((() => { try { return localStorage.getItem('hc:goal') } catch { return null } })()) || 5000000)
const editingGoal = ref(false)
function saveGoal(v) {
  goal.value = Math.max(0, Number(v) || 0)
  try { localStorage.setItem('hc:goal', goal.value) } catch { /* storage unavailable */ }
  editingGoal.value = false
}
const goalPct = computed(() => (goal.value ? Math.min(100, (m.closedWonQuarter.value / goal.value) * 100) : 0))
const weightedPct = computed(() => (goal.value ? Math.min(100 - goalPct.value, (m.weightedPipeline.value / goal.value) * 100) : 0))

const creating = ref(null)
</script>

<template>
  <div class="page stack">
    <div class="card page-header">
      <ObjectIcon object="home" />
      <div>
        <div class="eyebrow">Home</div>
        <h1 class="title">{{ greeting }}, {{ firstName }}</h1>
      </div>
      <span class="spacer" />
      <div class="btn-group">
        <button class="btn" :class="{ 'btn-brand': scope === 'mine' }" @click="scope = 'mine'">My Data</button>
        <button class="btn" :class="{ 'btn-brand': scope === 'all' }" @click="scope = 'all'">Team</button>
      </div>
    </div>

    <div class="grid-main">
      <div class="stack">
        <!-- Quarterly performance -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Quarterly Performance</span>
            <span class="muted small">As of today · {{ m.quarter.label }}</span>
          </div>
          <div class="card-body">
            <div class="kpis">
              <div><div class="kpi-label">Completed</div><div class="kpi">{{ money(m.closedWonQuarter.value) }}</div></div>
              <div><div class="kpi-label">Jobs in Progress</div><div class="kpi">{{ money(m.openPipeline.value) }}</div></div>
              <div><div class="kpi-label">Weighted Pipeline</div><div class="kpi">{{ money(m.weightedPipeline.value) }}</div></div>
              <div>
                <div class="kpi-label">Goal <button class="btn-icon bare small" aria-label="Edit goal" @click="editingGoal = true"><Icon name="edit" :size="12" /></button></div>
                <div v-if="!editingGoal" class="kpi">{{ money(goal) }}</div>
                <input v-else class="input" type="number" :value="goal" autofocus style="width: 130px"
                  @keydown.enter="saveGoal($event.target.value)" @blur="saveGoal($event.target.value)" />
              </div>
            </div>
            <div class="goal-track" :title="`${Math.round(goalPct)}% of goal closed`">
              <div class="goal-fill" :style="{ width: goalPct + '%' }" />
              <div class="goal-weighted" :style="{ width: weightedPct + '%' }" />
            </div>
            <div class="legend">
              <span><i class="sw closed" /> Completed</span>
              <span><i class="sw weighted" /> Weighted jobs in progress</span>
              <span class="muted">{{ Math.round(goalPct) }}% of goal</span>
            </div>
          </div>
        </div>

        <!-- Key deals -->
        <div class="card">
          <div class="card-header">
            <ObjectIcon object="opportunities" size="small" />
            <span class="card-title">Key Jobs - {{ scope === 'mine' ? 'My Opportunities' : 'All Opportunities' }}</span>
            <span class="spacer" />
            <button class="btn" @click="creating = 'opportunities'">New</button>
          </div>
          <div v-if="!m.topDeals.value.length" class="card-empty">No jobs in progress yet.</div>
          <div v-for="o in m.topDeals.value" :key="o.id" class="deal">
            <div style="min-width: 0">
              <RouterLink :to="`/o/opportunities/${o.id}`" class="truncate" style="display: block; font-weight: 600">{{ o.name }}</RouterLink>
              <div class="muted small truncate">{{ o.service || 'No service' }} · {{ nameOf('accounts', o.accountId) || 'No client' }} · deliver by {{ date(o.closeDate) }}</div>
            </div>
            <span class="badge">{{ o.stage }}</span>
            <div class="deal-amt">{{ money(o.amount) }}</div>
          </div>
          <div class="card-footer"><RouterLink to="/o/opportunities?view=open">View All</RouterLink></div>
        </div>

        <!-- Recent records -->
        <div class="card">
          <div class="card-header"><span class="card-title">Recent Records</span></div>
          <div v-if="!recent.length" class="card-empty">Records you create or update will show up here.</div>
          <RouterLink v-for="{ object, r } in recent" :key="object + r.id" :to="`/o/${object}/${r.id}`" class="recent">
            <ObjectIcon :object="object" size="small" />
            <span class="truncate" style="flex: 1">{{ recordName(object, r) }}</span>
            <span class="muted small">{{ OBJECTS[object].label }} · {{ timeAgo(r.updatedAt) }}</span>
          </RouterLink>
        </div>
      </div>

      <div class="stack">
        <!-- Assistant -->
        <div class="card">
          <div class="card-header"><span class="card-title">Assistant</span></div>
          <div v-if="!insights.length" class="card-empty">Nothing needs your attention right now. 🎉</div>
          <RouterLink v-for="(it, i) in insights" :key="i" :to="it.to" class="insight">
            <ObjectIcon :object="it.icon" size="small" /> <span>{{ it.text }}</span>
          </RouterLink>
        </div>

        <!-- Today's tasks -->
        <div class="card">
          <div class="card-header">
            <ObjectIcon object="tasks" size="small" />
            <span class="card-title">Today's Tasks</span>
            <span class="spacer" />
            <button class="btn-icon" aria-label="New task" title="New Task" @click="creating = 'tasks'"><Icon name="add" /></button>
          </div>
          <div v-if="!myTasks.length" class="card-empty">Nothing due today. Be a go-getter, and check back soon.</div>
          <div v-for="t in myTasks" :key="t.id" class="task-row">
            <input type="checkbox" :aria-label="'Complete ' + t.subject" @change="complete(t)" />
            <div style="min-width: 0; flex: 1">
              <RouterLink :to="`/o/tasks/${t.id}`" class="truncate" style="display: block">{{ t.subject }}</RouterLink>
              <div v-if="t.relatedId" class="muted small truncate">{{ nameOf(t.relatedType, t.relatedId) }}</div>
            </div>
            <span class="small" :class="t.dueDate && t.dueDate < today ? 'overdue' : 'muted'">{{ t.dueDate ? date(t.dueDate) : '' }}</span>
          </div>
          <div class="card-footer">
            <RouterLink to="/o/tasks?view=mine">View All</RouterLink>
            <span v-if="upcomingCount" class="muted small"> · {{ upcomingCount }} upcoming</span>
          </div>
        </div>
      </div>
    </div>

    <RecordFormModal v-if="creating" :object="creating" @close="creating = null" @saved="creating = null" />
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.kpi-label { font-size: 12px; color: var(--text-label); display: flex; align-items: center; gap: 4px; min-height: 24px; }
.kpi { font-size: 20px; font-weight: 300; font-variant-numeric: tabular-nums; }
.goal-track { height: 16px; background: var(--bg); border-radius: 8px; display: flex; overflow: hidden; gap: 2px; }
.goal-fill { background: var(--success-bright); border-radius: 8px 0 0 8px; transition: width .3s; }
.goal-weighted { background: #90d0fe; transition: width .3s; }
.legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.sw.closed { background: var(--success-bright); }
.sw.weighted { background: #90d0fe; }
.deal { display: grid; grid-template-columns: 1fr auto 100px; gap: 12px; align-items: center; padding: 8px 16px; border-top: 1px solid var(--border-light); }
.deal-amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.recent, .insight { display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-top: 1px solid var(--border-light); color: var(--text); }
.recent:hover, .insight:hover { background: var(--bg); text-decoration: none; color: var(--text); }
.task-row { display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-top: 1px solid var(--border-light); }
.overdue { color: var(--error-bright); font-weight: 600; }
@media (max-width: 700px) { .kpis { grid-template-columns: 1fr 1fr; } }
</style>
