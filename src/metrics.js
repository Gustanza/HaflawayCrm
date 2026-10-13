import { computed } from 'vue'
import { store } from './store.js'
import { OPP_STAGES, LEAD_SOURCES, SERVICES, WON_STAGE, LOST_STAGE, isClosedStage, isCommitted, owes } from './meta/objects.js'
import { todayISO, addDaysISO } from './format.js'

// Close dates are 'YYYY-MM-DD' strings, so string comparison works for ranges.
function quarterRange(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3)
  const start = new Date(d.getFullYear(), q * 3, 1)
  const end = new Date(d.getFullYear(), q * 3 + 3, 0)
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end), label: `Q${q + 1} ${d.getFullYear()}` }
}

const sum = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

export function useMetrics(scope) {
  // scope: ref('all' | 'mine')
  const opps = computed(() => store.opportunities.filter((o) => scope.value === 'all' || o.ownerId === store.user?.uid))
  const leads = computed(() => store.leads.filter((l) => scope.value === 'all' || l.ownerId === store.user?.uid))
  const quarter = quarterRange()

  const open = computed(() => opps.value.filter((o) => !isClosedStage(o.stage)))
  const won = computed(() => opps.value.filter((o) => o.stage === WON_STAGE))
  const lost = computed(() => opps.value.filter((o) => o.stage === LOST_STAGE))
  // When a job was finished: the recorded Completed Date, else its Delivery Date (older records).
  const doneDate = (o) => o.completedDate || o.closeDate || ''
  const wonThisQuarter = computed(() => won.value.filter((o) => doneDate(o) >= quarter.start && doneDate(o) <= quarter.end))

  return {
    quarter,
    openPipeline: computed(() => sum(open.value)),
    weightedPipeline: computed(() => open.value.reduce((s, o) => s + (Number(o.amount) || 0) * (o.probability ?? 0) / 100, 0)),
    openCount: computed(() => open.value.length),
    closedWonQuarter: computed(() => sum(wonThisQuarter.value)),
    winRate: computed(() => {
      const closed = won.value.length + lost.value.length
      return closed ? Math.round((won.value.length / closed) * 100) : null
    }),
    avgDeal: computed(() => (won.value.length ? sum(won.value) / won.value.length : 0)),
    openLeads: computed(() => leads.value.filter((l) => !['Converted', 'Unqualified'].includes(l.status)).length),
    conversionRate: computed(() => {
      const n = leads.value.length
      return n ? Math.round((leads.value.filter((l) => l.status === 'Converted').length / n) * 100) : null
    }),
    byStage: computed(() =>
      OPP_STAGES.filter((s) => !s.closed).map((s) => {
        const rows = open.value.filter((o) => o.stage === s.value)
        return { label: s.value, value: sum(rows), sub: `${rows.length} ${rows.length === 1 ? 'deal' : 'deals'}` }
      }),
    ),
    wonByMonth: computed(() => {
      const months = []
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        months.push({ label: d.toLocaleDateString(undefined, { month: 'short' }), value: sum(won.value.filter((o) => doneDate(o).startsWith(key))) })
      }
      return months
    }),
    leadsBySource: computed(() =>
      [...LEAD_SOURCES, null]
        .map((src) => {
          const n = leads.value.filter((l) => (l.source || null) === src).length
          return { label: src || 'Unspecified', value: n, sub: `${n} ${n === 1 ? 'lead' : 'leads'}` }
        })
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    ),
    // Money still owed on jobs the client has committed to (deposit paid or later).
    unpaid: computed(() => opps.value.filter(owes)
      .sort((a, b) => Number(b.balance) - Number(a.balance))),
    outstanding: computed(() => opps.value.filter(owes).reduce((s, o) => s + (Number(o.balance) || 0), 0)),
    collected: computed(() => opps.value.filter((o) => isCommitted(o.stage)).reduce((s, o) => s + (Number(o.amountPaid) || 0), 0)),
    revenueByService: computed(() =>
      [...SERVICES, null]
        .map((svc) => {
          const rows = won.value.filter((o) => (o.service || null) === svc)
          return { label: svc || 'Unspecified', value: sum(rows), sub: `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'}` }
        })
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    ),
    topDeals: computed(() => [...open.value].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 5)),
    closingSoon: computed(() => {
      const today = todayISO()
      const in14 = addDaysISO(today, 14)
      return open.value.filter((o) => o.closeDate && o.closeDate <= in14).sort((a, b) => a.closeDate.localeCompare(b.closeDate))
        .map((o) => ({ ...o, overdue: o.closeDate < today }))
    }),
  }
}
