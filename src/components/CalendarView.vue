<script setup>
// Month calendar of records by a date field (e.g. Event Date), colored and filterable by status.
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'
import { OBJECTS, NEUTRAL, recordName, fieldDef } from '../meta/objects.js'
import { date as fmtDate, todayISO } from '../format.js'
import { useClickOutside } from '../useClickOutside.js'

const props = defineProps({ object: String, records: Array })

const meta = OBJECTS[props.object]
const cfg = meta.calendar
const statuses = Object.keys(cfg.colors)
const colorOf = (r) => cfg.colors[r[cfg.colorField]] || NEUTRAL
const isNeutral = (r) => colorOf(r) === NEUTRAL
const dateLabel = fieldDef(props.object, cfg.dateField).label
const statusLabel = fieldDef(props.object, cfg.colorField).label

// ---- Month navigation ----
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = todayISO()
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const monthKey = computed(() => `${month.value.getFullYear()}-${pad(month.value.getMonth() + 1)}`)
const monthTitle = computed(() => month.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
function shift(n) { month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1) }
function goToday() { month.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
function jump(v) { if (v) { const [y, m] = v.split('-').map(Number); month.value = new Date(y, m - 1, 1) } }

// ---- Status filter (persisted per object for this viewer) ----
const storeKey = `hc:${props.object}:calStatus`
const selected = ref((() => { try { return JSON.parse(localStorage.getItem(storeKey)) || [] } catch { return [] } })())
watch(selected, (v) => { try { localStorage.setItem(storeKey, JSON.stringify(v)) } catch { /* storage unavailable */ } }, { deep: true })
function toggle(s) {
  selected.value = selected.value.includes(s) ? selected.value.filter((x) => x !== s) : [...selected.value, s]
}
const passes = (r) => !selected.value.length || selected.value.includes(r[cfg.colorField])

const dated = computed(() => props.records.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[cfg.dateField] || '')))
const undated = computed(() => props.records.length - dated.value.length)
const inMonth = computed(() => dated.value.filter((r) => r[cfg.dateField].startsWith(monthKey.value)))
const counts = computed(() => Object.fromEntries(statuses.map((s) => [s, inMonth.value.filter((r) => r[cfg.colorField] === s).length])))
const visible = computed(() =>
  inMonth.value.filter(passes).sort((a, b) => a[cfg.dateField].localeCompare(b[cfg.dateField]) || recordName(props.object, a).localeCompare(recordName(props.object, b))),
)

// ---- Grid (weeks start on Monday) ----
const weeks = computed(() => {
  const first = month.value
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  const byDay = {}
  for (const r of visible.value) (byDay[r[cfg.dateField]] ||= []).push(r)
  const rows = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i)
      const key = iso(d)
      days.push({ key, day: d.getDate(), inMonth: d.getMonth() === first.getMonth(), items: byDay[key] || [] })
    }
    if (w >= 4 && !days.some((d) => d.inMonth)) break
    rows.push(days)
  }
  return rows
})
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CHIPS = 3

// ---- "+N more" day popover ----
const openDay = ref(null)
const popEl = ref(null)
useClickOutside(popEl, () => (openDay.value = null))

const chipStyle = (r) => ({ '--c': colorOf(r) })
const tip = (r) => `${recordName(props.object, r)} — ${statusLabel}: ${r[cfg.colorField] || 'None'}${cfg.detail(r) ? ' — ' + cfg.detail(r) : ''}`
</script>

<template>
  <div class="cal">
    <div class="cal-toolbar">
      <div class="btn-group">
        <button class="btn-icon" aria-label="Previous month" @click="shift(-1)"><Icon name="right" style="transform: rotate(180deg)" /></button>
        <button class="btn-icon" aria-label="Next month" @click="shift(1)"><Icon name="right" /></button>
      </div>
      <button class="btn" @click="goToday">Today</button>
      <h2 class="cal-title">{{ monthTitle }}</h2>
      <input class="input month-pick" type="month" :value="monthKey" aria-label="Jump to month" @change="jump($event.target.value)" />
    </div>

    <!-- Status filter / legend: color is never the only cue (each chip is labelled). -->
    <div class="cal-filters" role="group" :aria-label="`Filter by ${statusLabel}`">
      <span class="muted small">Show:</span>
      <button class="fchip" :class="{ on: !selected.length }" @click="selected = []">All <span class="n">{{ inMonth.length }}</span></button>
      <button
        v-for="s in statuses" :key="s" class="fchip" :class="{ on: selected.includes(s), neutral: cfg.colors[s] === NEUTRAL }"
        :style="{ '--c': cfg.colors[s] }" :aria-pressed="selected.includes(s)" @click="toggle(s)"
      >
        <i class="dot" /> {{ s }} <span class="n">{{ counts[s] }}</span>
      </button>
      <span class="spacer" />
      <span class="muted small">By {{ dateLabel }}<template v-if="undated"> · {{ undated }} without a date</template></span>
    </div>

    <div class="grid" role="grid" :aria-label="monthTitle">
      <div v-for="w in WEEKDAYS" :key="w" class="wd" role="columnheader">{{ w }}</div>
      <template v-for="(week, wi) in weeks" :key="wi">
        <div v-for="(d, di) in week" :key="d.key" class="day" :class="{ out: !d.inMonth, today: d.key === today, past: d.key < today }" role="gridcell">
          <div class="day-num"><span>{{ d.day }}</span></div>
          <RouterLink
            v-for="r in d.items.slice(0, MAX_CHIPS)" :key="r.id" :to="`/o/${object}/${r.id}`"
            class="chip" :class="{ neutral: isNeutral(r) }" :style="chipStyle(r)" :title="tip(r)"
          >
            <span class="chip-name">{{ recordName(object, r) }}</span>
            <span class="chip-status">{{ r[cfg.colorField] }}</span>
          </RouterLink>
          <div v-if="d.items.length > MAX_CHIPS" class="more-wrap">
            <button class="more" @click.stop="openDay = d.key">+{{ d.items.length - MAX_CHIPS }} more</button>
            <div v-if="openDay === d.key" :ref="(el) => { if (el) popEl = el }" class="pop" :class="{ right: di >= 4 }">
              <div class="pop-title">{{ fmtDate(d.key) }}</div>
              <RouterLink v-for="r in d.items" :key="r.id" :to="`/o/${object}/${r.id}`" class="chip" :class="{ neutral: isNeutral(r) }" :style="chipStyle(r)">
                <span class="chip-name">{{ recordName(object, r) }}</span>
                <span class="chip-status">{{ r[cfg.colorField] }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Agenda: the same events as a readable list (table view of the calendar). -->
    <div class="agenda">
      <div class="agenda-head">
        <span class="card-title">{{ selected.length ? selected.join(', ') : 'All' }} · {{ monthTitle }}</span>
        <span class="muted small">{{ visible.length }} {{ visible.length === 1 ? 'event' : 'events' }}</span>
      </div>
      <table v-if="visible.length" class="table cards">
        <thead>
          <tr><th>{{ dateLabel }}</th><th>{{ meta.label }}</th><th>Details</th><th>{{ statusLabel }}</th><th>Phone</th><th>Owner</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in visible" :key="r.id" :class="{ 'row-past': r[cfg.dateField] < today }">
            <td style="white-space: nowrap" :data-label="dateLabel">{{ fmtDate(r[cfg.dateField]) }}</td>
            <td class="truncate primary"><RouterLink :to="`/o/${object}/${r.id}`">{{ recordName(object, r) }}</RouterLink></td>
            <td class="truncate muted" data-label="Details">{{ cfg.detail(r) }}</td>
            <td :data-label="statusLabel"><span class="status" :class="{ neutral: isNeutral(r) }" :style="chipStyle(r)"><i class="dot" />{{ r[cfg.colorField] || '—' }}</span></td>
            <td data-label="Phone"><a v-if="r.phone" :href="'tel:' + r.phone">{{ r.phone }}</a></td>
            <td class="truncate" data-label="Owner">{{ r.ownerName }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="card-empty">
        No events {{ selected.length ? `with ${statusLabel.toLowerCase()} ${selected.join(' or ')}` : '' }} in {{ monthTitle }}.
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal { padding: 0 16px 16px; }
.cal-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.cal-title { font-size: 18px; font-weight: 700; margin: 0 8px; min-width: 160px; }
.month-pick { width: 160px; }

.cal-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.fchip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 14px;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 12px; color: var(--text);
}
.fchip:hover { background: var(--bg); }
.fchip.on { border-color: var(--brand); background: var(--brand-light); color: var(--brand-dark); font-weight: 700; box-shadow: inset 0 0 0 1px var(--brand); }
.fchip .n { color: var(--text-weak); font-weight: 400; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.neutral .dot { background: transparent; border: 2px dashed var(--c); width: 10px; height: 10px; }

.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--border-light); border-left: 1px solid var(--border-light); }
.wd { padding: 6px 8px; font-size: 12px; font-weight: 700; color: var(--text-label); background: #fafaf9; border-right: 1px solid var(--border-light); border-bottom: 1px solid var(--border-light); }
.day { min-height: 112px; padding: 4px; border-right: 1px solid var(--border-light); border-bottom: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 3px; min-width: 0; position: relative; }
.day.out { background: #fafaf9; }
.day.out .day-num { color: #aeaeae; }
.day-num { font-size: 12px; text-align: right; padding: 0 2px; }
.day.today .day-num span { background: var(--brand); color: #fff; border-radius: 50%; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; font-weight: 700; }

.chip {
  display: flex; flex-direction: column; padding: 2px 6px; border-radius: 3px; min-width: 0;
  background: color-mix(in srgb, var(--c) 14%, #fff); border-left: 3px solid var(--c); color: var(--text); line-height: 1.25;
}
.chip:hover { text-decoration: none; color: var(--text); background: color-mix(in srgb, var(--c) 24%, #fff); }
.chip.neutral { background: #f3f3f3; border-left-style: dashed; color: var(--text-weak); }
.chip-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-status { font-size: 11px; color: var(--text-weak); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day.past:not(.out) .chip { opacity: .7; }

.more-wrap { position: relative; }
.more { background: none; border: 0; padding: 0 4px; font-size: 12px; color: var(--brand); cursor: pointer; }
.more:hover { text-decoration: underline; }
.pop {
  position: absolute; z-index: 30; top: 100%; left: 0; width: 240px; max-height: 320px; overflow-y: auto; padding: 8px;
  background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: var(--shadow-drop);
  display: flex; flex-direction: column; gap: 4px;
}
.pop.right { left: auto; right: 0; }
.pop-title { font-weight: 700; padding-bottom: 4px; }

.agenda { margin-top: 16px; border: 1px solid var(--border-light); border-radius: var(--radius); }
.agenda-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; }
.status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.row-past td { color: var(--text-weak); }

@media (max-width: 800px) {
  .day { min-height: 72px; }
  .chip-status { display: none; }
}
@media (max-width: 640px) {
  .cal { padding: 0 8px 12px; }
  .cal-title { min-width: 0; margin: 0 4px; font-size: 16px; }
  .month-pick { flex: 1 1 120px; width: auto; }
  .cal-filters > .spacer { display: none; }
  .wd { padding: 4px 2px; text-align: center; font-size: 11px; }
  .day { min-height: 56px; padding: 2px; gap: 2px; }
  .day-num { text-align: center; font-size: 11px; }
  .chip { padding: 1px 3px; border-left-width: 2px; }
  .chip-name { font-size: 10px; }
  .more { font-size: 10px; padding: 0 2px; }
  .agenda-head { padding: 10px 12px 4px; }
}
</style>
