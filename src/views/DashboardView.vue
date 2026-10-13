<script setup>
import { ref } from 'vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import BarList from '../components/BarList.vue'
import ColumnChart from '../components/ColumnChart.vue'
import { useMetrics } from '../metrics.js'
import { nameOf } from '../store.js'
import { money, date } from '../format.js'

const scope = ref('all')
const m = useMetrics(scope)
const compact = (v) => money(v, true)
const refreshed = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
</script>

<template>
  <div class="page stack">
    <div class="card page-header">
      <ObjectIcon object="dashboard" />
      <div>
        <div class="eyebrow">Dashboard</div>
        <h1 class="title">Jobs &amp; Revenue Overview</h1>
        <div class="meta">Live data · Opened {{ refreshed }} · Viewing as {{ scope === 'all' ? 'Team' : 'Me' }}</div>
      </div>
      <span class="spacer" />
      <div class="btn-group">
        <button class="btn" :class="{ 'btn-brand': scope === 'mine' }" @click="scope = 'mine'">My Data</button>
        <button class="btn" :class="{ 'btn-brand': scope === 'all' }" @click="scope = 'all'">Team</button>
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
@media (max-width: 1000px) { .charts { grid-template-columns: 1fr; } }
</style>
