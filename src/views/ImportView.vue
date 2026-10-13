<script setup>
import { ref, computed } from 'vue'
import Icon from '../components/Icon.vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import Modal from '../components/Modal.vue'
import { readOldData, buildPlan, backupJson, runImport, existingIds } from '../migration/haflaway.js'
import { toast } from '../store.js'
import { money, date } from '../format.js'

const phase = ref('idle') // idle | scanning | scanned | importing | done
const progress = ref('')
const error = ref('')
const data = ref(null)
const plan = ref(null)
const already = ref({})
const overwrite = ref(false)
const confirmOpen = ref(false)
const result = ref(null)
const pct = ref(0)

const LABEL = { leads: 'Leads', accounts: 'Accounts', contacts: 'Contacts', opportunities: 'Opportunities (jobs)', tasks: 'Tasks (follow-ups)', activities: 'Activities (calls, notes, payments)' }
const ORDER = ['leads', 'accounts', 'contacts', 'opportunities', 'tasks', 'activities']

const rows = computed(() => ORDER.map((c) => {
  const ids = (plan.value?.writes || []).filter((w) => w.col === c).map((w) => w.id)
  const exists = ids.filter((id) => already.value[c]?.has(id)).length
  return { c, total: ids.length, exists, create: overwrite.value ? ids.length : ids.length - exists }
}))
const toWrite = computed(() => rows.value.reduce((s, r) => s + r.create, 0))
const previewFilter = ref('')
const preview = computed(() => {
  const q = previewFilter.value.trim().toLowerCase()
  return (plan.value?.preview || []).filter((p) => !q || `${p.name} ${p.phone} ${p.oldStatus} ${p.newStatus}`.toLowerCase().includes(q))
})

async function scan() {
  phase.value = 'scanning'
  error.value = ''
  try {
    data.value = await readOldData((m) => (progress.value = m))
    plan.value = buildPlan(data.value)
    progress.value = 'Checking what is already in HaflaCREM...'
    already.value = await existingIds()
    phase.value = 'scanned'
  } catch (e) {
    error.value = e.message
    phase.value = 'idle'
  }
}

function download() {
  const blob = new Blob([backupJson(data.value)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `haflaway-crm-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function start() {
  confirmOpen.value = false
  phase.value = 'importing'
  pct.value = 0
  try {
    result.value = await runImport(plan.value, { overwrite: overwrite.value, onProgress: (d, t) => (pct.value = Math.round((d / t) * 100)) })
    phase.value = 'done'
    toast(`Import finished: ${result.value.written} records added.`)
  } catch (e) {
    error.value = e.message
    phase.value = 'scanned'
  }
}
</script>

<template>
  <div class="page stack">
    <div class="card page-header">
      <span class="obj-tile"><Icon name="refresh" :size="20" /></span>
      <div>
        <div class="eyebrow">Setup</div>
        <h1 class="title">Import from Haflaway CRM</h1>
        <div class="meta">Copies leads, deals, payments and history from the old app into HaflaCREM.</div>
      </div>
    </div>

    <div class="card card-body safe">
      <Icon name="info" :size="18" />
      <div>
        <strong>Your old app is not changed.</strong> This tool only <em>reads</em> Haflaway CRM data and creates copies in
        HaflaCREM. Nothing in Haflaway CRM is edited or deleted, so it keeps working. You can run it again later: records already
        imported are skipped.
      </div>
    </div>

    <div v-if="error" class="alert error"><Icon name="warning" /> {{ error }}</div>

    <!-- Step 1 -->
    <div class="card">
      <div class="card-header"><span class="step">1</span><span class="card-title">Scan the old data</span></div>
      <div class="card-body">
        <p class="muted" style="margin-bottom: 12px">Reads everything and shows exactly what will be created. Nothing is saved yet.</p>
        <button class="btn btn-brand" :disabled="phase === 'scanning' || phase === 'importing'" @click="scan">
          <Icon name="search" /> {{ phase === 'idle' ? 'Scan Haflaway CRM' : 'Scan again' }}
        </button>
        <span v-if="phase === 'scanning'" class="muted" style="margin-left: 12px">{{ progress }}</span>
      </div>
    </div>

    <template v-if="plan && phase !== 'scanning'">
      <div class="tiles">
        <div class="card tile"><div class="tile-label">Leads found</div><div class="tile-value">{{ plan.stats.leads }}</div></div>
        <div class="card tile"><div class="tile-label">Deals</div><div class="tile-value">{{ plan.stats.deals }}</div></div>
        <div class="card tile"><div class="tile-label">Activities</div><div class="tile-value">{{ plan.stats.activities }}</div><div class="muted small">{{ plan.stats.voidedActivities }} voided, skipped</div></div>
        <div class="card tile"><div class="tile-label">Payments</div><div class="tile-value">{{ plan.stats.payments }}</div><div class="muted small">{{ plan.stats.voidedPayments }} voided, skipped</div></div>
      </div>

      <!-- Step 2 -->
      <div class="card">
        <div class="card-header"><span class="step">2</span><span class="card-title">Download a backup</span></div>
        <div class="card-body">
          <p class="muted" style="margin-bottom: 12px">A complete copy of the old data as a file, for safekeeping. Recommended before importing.</p>
          <button class="btn" @click="download"><Icon name="note" /> Download backup (.json)</button>
        </div>
      </div>

      <!-- Step 3 -->
      <div class="card">
        <div class="card-header"><span class="step">3</span><span class="card-title">Review and import</span></div>
        <table class="table">
          <thead><tr><th>Will create in HaflaCREM</th><th class="num">Records</th><th class="num">Already imported</th><th class="num">To add now</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.c">
              <td><span class="row"><ObjectIcon :object="r.c === 'activities' ? 'call' : r.c" size="small" /> {{ LABEL[r.c] }}</span></td>
              <td class="num">{{ r.total }}</td>
              <td class="num">{{ r.exists }}</td>
              <td class="num"><strong>{{ r.create }}</strong></td>
            </tr>
          </tbody>
        </table>
        <div class="card-body" style="padding-top: 12px">
          <div v-if="plan.warnings.length" class="warnings">
            <div class="row" style="font-weight: 700"><Icon name="warning" /> {{ plan.warnings.length }} thing{{ plan.warnings.length === 1 ? '' : 's' }} to know</div>
            <ul><li v-for="(w, i) in plan.warnings.slice(0, 30)" :key="i">{{ w }}</li></ul>
            <div v-if="plan.warnings.length > 30" class="muted small">...and {{ plan.warnings.length - 30 }} more (all are in the backup's data).</div>
          </div>
          <label class="row" style="margin: 12px 0"><input v-model="overwrite" type="checkbox" />
            Overwrite records imported before (replaces any changes you made to them in HaflaCREM)</label>
          <div class="row">
            <button class="btn btn-brand" :disabled="!toWrite || phase === 'importing'" @click="confirmOpen = true">
              <Icon name="convert" /> Import {{ toWrite }} records
            </button>
            <span v-if="!toWrite && phase !== 'done'" class="muted">Everything is already imported.</span>
          </div>
          <div v-if="phase === 'importing'" class="bar"><div class="bar-fill" :style="{ width: pct + '%' }" /></div>
          <div v-if="phase === 'done'" class="alert success-alert">
            <Icon name="check" /> Done: {{ result.written }} records added, {{ result.skipped }} already there.
            <RouterLink to="/o/leads?view=all">Open Leads</RouterLink> · <RouterLink to="/o/opportunities?view=all">Open Jobs</RouterLink>
          </div>
        </div>
      </div>

      <!-- Preview -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">How each lead will look</span>
          <span class="spacer" />
          <input v-model="previewFilter" class="input" style="width: 240px" placeholder="Filter by name, phone, status" />
        </div>
        <table class="table">
          <thead><tr><th>Lead</th><th>Phone</th><th>Event</th><th>Status in old app</th><th>Status in HaflaCREM</th><th>Jobs → stage</th><th class="num">Won</th><th class="num">Owed</th></tr></thead>
          <tbody>
            <tr v-for="p in preview.slice(0, 200)" :key="p.id">
              <td class="truncate">{{ p.name }}</td>
              <td>{{ p.phone }}</td>
              <td class="truncate">{{ [p.eventType, date(p.eventDate)].filter(Boolean).join(' · ') }}</td>
              <td>{{ p.oldStatus }}</td>
              <td><span class="badge" :class="{ success: p.newStatus === 'Converted', inverse: p.newStatus === 'Unqualified' }">{{ p.newStatus }}</span></td>
              <td class="small">{{ p.services.join(', ') }}</td>
              <td class="num">{{ p.won ? money(p.won) : '' }}</td>
              <td class="num" :style="{ color: p.owed ? 'var(--error-bright)' : '' }">{{ p.owed ? money(p.owed) : '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="preview.length > 200" class="card-footer muted small">Showing 200 of {{ preview.length }}.</div>
      </div>
    </template>

    <Modal v-if="confirmOpen" small title="Import into HaflaCREM?" @close="confirmOpen = false">
      <p>This adds <strong>{{ toWrite }}</strong> records to HaflaCREM. Haflaway CRM stays exactly as it is.</p>
      <template #footer>
        <button class="btn" @click="confirmOpen = false">Cancel</button>
        <button class="btn btn-brand" @click="start">Import</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.obj-tile { width: 32px; height: 32px; border-radius: 4px; background: #7f8de1; color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.safe { display: flex; gap: 10px; align-items: flex-start; padding-top: 16px; background: #eef4ff; border-color: #c3d9f8; }
.step { width: 24px; height: 24px; border-radius: 50%; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.tile { padding: 16px; text-align: center; }
.tile-label { font-weight: 600; color: var(--text-label); }
.tile-value { font-size: 28px; font-weight: 300; color: var(--brand-dark); }
.warnings { background: #fef1c7; border-radius: var(--radius); padding: 10px 14px; color: #5c3a00; }
.warnings ul { margin: 6px 0 0; padding-left: 20px; }
.bar { height: 8px; background: var(--bg); border-radius: 4px; margin-top: 12px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--brand); transition: width .2s; }
.success-alert { background: #c8f2d6; color: #194e31; margin-top: 12px; }
</style>
