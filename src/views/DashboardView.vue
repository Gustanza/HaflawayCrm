<script setup>
import { ref, computed } from 'vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import BarList from '../components/BarList.vue'
import ColumnChart from '../components/ColumnChart.vue'
import { useMetrics } from '../metrics.js'
import { store, nameOf, isAdmin, teamMembers } from '../store.js'
import { isClosedStage, owes, WON_STAGE } from '../meta/objects.js'
import { money, date, todayISO } from '../format.js'

// Reps only have their own records; admins see the team and can look at one person at a time.
const scope = ref('all')
const m = useMetrics(scope)
const compact = (v) => money(v, true)
const refreshed = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const viewingAs = computed(() => {
  if (!isAdmin()) return 'Me'
  if (scope.value === 'all') return 'Team'
  return scope.value === store.user.uid ? 'Me' : teamMembers().find((u) => u.id === scope.value)?.name || 'Team member'
})

// One row per person (plus records nobody owns), so an admin can compare the team at a glance.
const amount = (rows, f = 'amount') => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0)
const team = computed(() => {
  const today = todayISO()
  const { start, end } = m.quarter
  const people = [...teamMembers().map((u) => ({ id: u.id, name: u.name || u.email })), { id: null, name: 'No owner' }]
  return people.map((p) => {
    const owned = (r) => (p.id ? r.ownerId === p.id : !r.ownerId)
    const opps = store.opportunities.filter(owned)
    const done = opps.filter((o) => o.stage === WON_STAGE && (o.completedDate || o.closeDate || '') >= start && (o.completedDate || o.closeDate || '') <= end)
    return {
      ...p,
      openLeads: store.leads.filter((l) => owned(l) && !['Converted', 'Unqualified'].includes(l.status)).length,
      openJobs: amount(opps.filter((o) => !isClosedStage(o.stage))),
      completed: amount(done),
      unpaid: amount(opps.filter(owes), 'balance'),
      overdueTasks: store.tasks.filter((t) => owned(t) && t.status !== 'Completed' && t.dueDate && t.dueDate < today).length,
      total: opps.length + store.leads.filter(owned).length,
    }
  }).filter((p) => p.id || p.total)
})
</script>

<template>
  <div class="page stack">
    <div class="card page-header">
      <ObjectIcon object="dashboard" />
      <div>
        <div class="eyebrow">Dashboard</div>
        <h1 class="title">Jobs &amp; Revenue Overview</h1>
        <div class="meta">Live data · Opened {{ refreshed }} · Viewing as {{ viewingAs }}</div>
      </div>
      <span class="spacer" />
      <select v-if="isAdmin()" v-model="scope" class="select scope-select" aria-label="Whose data to show">
        <option value="all">Whole team</option>
        <option v-for="u in teamMembers()" :key="u.id" :value="u.id">{{ u.id === store.user.uid ? 'Me' : u.name || u.email }}</option>
      </select>
    </div>

    <div v-if="isAdmin() && scope === 'all'" class="card">
      <div class="card-header"><span class="card-title">Team Performance</span><span class="muted small">Click a name to see their numbers · Completed is {{ m.quarter.label }}</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Owner</th><th class="num">Open Leads</th><th class="num">Jobs in Progress</th><th class="num">Completed</th><th class="num">Unpaid</th><th class="num">Overdue Tasks</th></tr></thead>
          <tbody>
            <tr v-for="p in team" :key="p.id || 'none'">
              <td><button v-if="p.id" class="link-btn" @click="scope = p.id">{{ p.name }}</button><span v-else class="muted">{{ p.name }}</span></td>
              <td class="num"><RouterLink :to="`/o/leads?view=open&owner=${p.id || 'none'}`">{{ p.openLeads }}</RouterLink></td>
              <td class="num">{{ money(p.openJobs) || money(0) }}</td>
              <td class="num">{{ money(p.completed) || money(0) }}</td>
              <td class="num" :class="{ owed: p.unpaid > 0 }">{{ money(p.unpaid) || money(0) }}</td>
              <td class="num" :class="{ owed: p.overdueTasks > 0 }">{{ p.overdueTasks }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="tiles">
      <div class="card tile"><div class="tile-label">Jobs in Progress</div><div class="tile-value">{{ compact(m.openPipeline.value) }}</div><div class="muted small">{{ m.openCount.value }} open jobs</div></div>
      <div class="card tile"><div class="tile-label">Completed ({{ m.quarter.label }})</div><div class="tile-value">{{ compact(m.closedWonQuarter.value) }}</div><div class="muted small">This quarter</div></div>
      <div class="card tile"><div class="tile-label">Unpaid Balances</div><div class="tile-value" :class="{ owed: m.outstanding.value > 0 }">{{ compact(m.outstanding.value) }}</div><div class="muted small">{{ m.unpaid.value.length }} {{ m.unpaid.value.length === 1 ? 'client owes' : 'clients owe' }}</div></div>
      <div class="card tile"><div class="tile-label">Win Rate</div><div class="tile-value">{{ m.winRate.value == null ? '—' : m.winRate.value + '%' }}</div><div class="muted small">Completed ÷ (completed + lost)</div></div>
      <div class="card tile"><div class="tile-label">Average Job Value</div><div class="tile-value">{{ compact(m.avgDeal.value) }}</div><div class="muted small">Completed jobs</div></div>
      <div class="card tile"><div class="tile-label">Open Leads</div><div class="tile-value">{{ m.openLeads.value }}</div><div class="muted small">{{ m.conversionRate.value == null ? 'No leads yet' : m.conversionRate.value + '% converted overall' }}</div></div>
    </div>

    <div class="charts">
      <div class="card">
        <div class="card-header"><span class="card-title">Jobs in Progress by Stage</span><span class="muted small">Sum of Total Price</span></div>
        <div class="card-body"><BarList :items="m.byStage.value" :format="compact" /></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Completed Revenue by Month</span><span class="muted small">Last 6 months · by Completed Date</span></div>
        <div class="card-body"><ColumnChart :items="m.wonByMonth.value" :format="compact" /></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Leads by Source</span><span class="muted small">Record count</span></div>
        <div class="card-body">
          <BarList v-if="m.leadsBySource.value.length" :items="m.leadsBySource.value" />
          <div v-else class="card-empty">No leads yet.</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Completed Revenue by Service</span><span class="muted small">All time</span></div>
        <div class="card-body">
          <BarList v-if="m.revenueByService.value.length" :items="m.revenueByService.value" :format="compact" />
          <div v-else class="card-empty">No completed jobs yet.</div>
        </div>
      </div>
      <div class="card wide">
        <div class="card-header"><span class="card-title">Clients With Unpaid Balances</span><span class="muted small">Collected so far: {{ money(m.collected.value) || money(0) }}</span></div>
        <table v-if="m.unpaid.value.length" class="table">
          <thead><tr><th>Job</th><th>Client</th><th>Stage</th><th>Event Date</th><th class="num">Total Price</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
          <tbody>
            <tr v-for="o in m.unpaid.value" :key="o.id">
              <td class="truncate"><RouterLink :to="`/o/opportunities/${o.id}`">{{ o.name }}</RouterLink></td>
              <td class="truncate">{{ nameOf('accounts', o.accountId) }}</td>
              <td>{{ o.stage }}</td>
              <td>{{ date(o.eventDate) }}</td>
              <td class="num">{{ money(o.amount) }}</td>
              <td class="num">{{ money(o.amountPaid) || money(0) }}</td>
              <td class="num owed">{{ money(o.balance) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="card-empty">Everyone has paid in full.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.tile { padding: 16px; text-align: center; }
.tile-label { font-size: 13px; color: var(--text-label); font-weight: 600; }
.tile-value { font-size: 32px; font-weight: 300; line-height: 1.3; font-variant-numeric: tabular-nums; color: var(--brand-dark); }
.charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.charts .card-header { justify-content: space-between; }
.charts .wide { grid-column: 1 / -1; }
.owed { color: var(--error-bright); }
.scope-select { width: 200px; }
@media (max-width: 1000px) { .charts { grid-template-columns: 1fr; } }
</style>
