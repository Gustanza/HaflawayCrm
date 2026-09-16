/**
 * The owner/manager dashboard — TODO.md §1/§5 screen 6.
 *
 * "We called 100 people today, 10 started working with us, 5 reminders, 3 contribution
 * cards, 1 committee invite, 1 event invitation" — for whichever period (day/week/month/
 * quarter) is selected. This is a manager/admin screen; the underlying collection-group
 * queries are rejected by firestore.rules for anyone else (see queries.js).
 *
 * Not real-time and not rolled up — at this scale a handful of one-shot queries per period
 * switch is cheap and simple. Revisit with precomputed rollup docs only if this is ever
 * measurably slow (TODO.md §11.3's own "load-bearing" cost discipline still applies, just not
 * urgently at this volume).
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getDocs } from 'firebase/firestore'
import { useAuthStore } from '@/stores/auth.js'
import { dayKey, weekKey, monthKey, quarterKey } from '@/domain/periods.js'
import { PRODUCT_TYPES, LOST_REASONS } from '@/domain/taxonomies.js'
import {
  leadsCreatedInPeriodQuery,
  activitiesInPeriodQuery,
  dealsClosedInPeriodQuery,
  upcomingEventsQuery,
  hotLeadsQuery,
} from '@/services/queries.js'

export const PERIODS = Object.freeze(['day', 'week', 'month', 'quarter'])

const PERIOD_FIELD = Object.freeze({
  day: 'dayKey',
  week: 'weekKey',
  month: 'monthKey',
  quarter: 'quarterKey',
})

const PERIOD_KEY_FN = Object.freeze({
  day: dayKey,
  week: weekKey,
  month: monthKey,
  quarter: quarterKey,
})

function zeroCountsByType(types) {
  return Object.fromEntries(types.map((t) => [t, 0]))
}

function countBy(docs, field) {
  const counts = {}
  for (const d of docs) {
    const key = d.data()[field]
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export const useDashboardStore = defineStore('dashboard', () => {
  const auth = useAuthStore()

  const period = ref('day')
  const now = ref(new Date())

  const periodValue = computed(() => PERIOD_KEY_FN[period.value](now.value))

  const leadsCreated = ref(0)
  const contactsMade = ref(0)
  const closedWonByProduct = ref(zeroCountsByType(PRODUCT_TYPES))
  const lostByReason = ref(zeroCountsByType(LOST_REASONS))
  const upcomingEvents = ref([])
  const hotLeads = ref([])

  const loading = ref(false)
  const error = ref(null)
  const loaded = ref(false)

  const totalClosedWon = computed(() =>
    Object.values(closedWonByProduct.value).reduce((a, b) => a + b, 0),
  )

  async function load() {
    loading.value = true
    error.value = null
    now.value = new Date()

    try {
      const user = { uid: auth.uid, orgId: auth.orgId, teamId: auth.teamId, role: auth.role }
      const periodField = PERIOD_FIELD[period.value]
      const value = periodValue.value

      const eventWindowStart = new Date()
      const eventWindowEnd = new Date(eventWindowStart.getTime() + 30 * 24 * 60 * 60 * 1000)

      const [createdSnap, activitySnap, wonSnap, lostSnap, eventsSnap, hotSnap] = await Promise.all([
        getDocs(await leadsCreatedInPeriodQuery(user, { periodField, periodValue: value })),
        getDocs(await activitiesInPeriodQuery(user, { periodField, periodValue: value })),
        getDocs(await dealsClosedInPeriodQuery(user, { status: 'closed_won', periodField, periodValue: value })),
        getDocs(await dealsClosedInPeriodQuery(user, { status: 'closed_lost', periodField, periodValue: value })),
        getDocs(await upcomingEventsQuery(user, { start: eventWindowStart, end: eventWindowEnd })),
        getDocs(await hotLeadsQuery(user)),
      ])

      leadsCreated.value = createdSnap.size
      contactsMade.value = activitySnap.size
      closedWonByProduct.value = { ...zeroCountsByType(PRODUCT_TYPES), ...countBy(wonSnap.docs, 'productType') }
      lostByReason.value = { ...zeroCountsByType(LOST_REASONS), ...countBy(lostSnap.docs, 'lostReason') }
      upcomingEvents.value = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      hotLeads.value = hotSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      loaded.value = true
    } catch (err) {
      error.value = err
    } finally {
      loading.value = false
    }
  }

  function setPeriod(next) {
    if (!PERIODS.includes(next)) return
    period.value = next
    return load()
  }

  return {
    period, periodValue, PERIODS,
    leadsCreated, contactsMade, closedWonByProduct, totalClosedWon, lostByReason,
    upcomingEvents, hotLeads,
    loading, error, loaded,
    load, setPeriod,
  }
})
