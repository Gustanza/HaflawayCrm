/**
 * The Dashboard — progress for a day, week, month or quarter. TODO.md §1/§5 screen 6.
 *
 * "I tried 18 people this week, reached 10, closed 4 — two reminders, one invitation card,
 * one committee invite — and here is who took what, and when their event is."
 *
 * One fetch covers BOTH the selected period and the one before it, so every headline number
 * can show its ▲▼ change without a second round trip. All the arithmetic lives in
 * domain/progress.js, which is pure and unit-tested; this store only fetches and maps.
 *
 * Manager/admin only: the collection-group reads are rejected by firestore.rules for anyone
 * else (see queries.js). Not real-time — a handful of one-shot reads per period switch is
 * cheap at this scale. Revisit with precomputed daily rollups if it ever gets slow.
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { getDocs, getDoc, doc } from 'firebase/firestore'
import { getDb } from '@/firebase/app.js'
import { useAuthStore } from '@/stores/auth.js'
import { dayKey } from '@/domain/periods.js'
import {
  PERIODS, periodRange, previousPeriodRange, periodBuckets,
  summarise, bucketSeries, bySalesperson, pitchNext,
  firstContactStats, waitingForFirstContact,
} from '@/domain/progress.js'
import {
  activitiesInDayRangeQuery,
  leadsCreatedInDayRangeQuery,
  dealsClosedInDayRangeQuery,
  leadDealsQuery,
  neverContactedLeadsQuery,
  upcomingEventsQuery,
  hotLeadsQuery,
} from '@/services/queries.js'

/** How far back "they bought something" counts for the pitch-the-next list. */
const PITCH_LOOKBACK_DAYS = 365
/** Caps on per-lead follow-up reads, so a busy quarter cannot fan out into hundreds. */
const MAX_CLOSED_LISTED = 50
const MAX_PITCH_LEADS = 60

const parentLeadId = (snap) => snap.ref.parent.parent?.id ?? null

function mapActivity(snap) {
  const a = snap.data()
  return { leadId: parentLeadId(snap), dayKey: a.dayKey, at: a.at, outcome: a.outcome, byUserId: a.byUserId, isVoided: a.isVoided === true }
}

function mapDeal(snap) {
  return { id: snap.id, leadId: parentLeadId(snap), ...snap.data() }
}

export const useDashboardStore = defineStore('dashboard', () => {
  const auth = useAuthStore()

  const period = ref('week')
  const range = ref(periodRange('week'))
  const previousRange = ref(previousPeriodRange('week'))

  const current = shallowRef(null)
  const previous = shallowRef(null)
  const series = shallowRef([])
  const people = shallowRef([])
  /** [{ deal, lead, openProducts }] — deals won in the period, newest first. */
  const closedDeals = shallowRef([])
  /** [{ lead, taken, inProgress, notYet, eventDay }] */
  const pitchList = shallowRef([])
  const upcomingEvents = shallowRef([])
  const hotLeads = shallowRef([])
  /** { waiting, pastWindow, current: { contacted, avgMs }, previous: { contacted, avgMs } } */
  const speed = shallowRef(null)

  const loading = ref(false)
  const error = ref(null)
  const loaded = ref(false)

  const hasChart = computed(() => series.value.length > 1)

  let loadSeq = 0

  async function load() {
    const seq = ++loadSeq
    loading.value = true
    error.value = null

    try {
      const now = new Date()
      const user = { uid: auth.uid, orgId: auth.orgId, teamId: auth.teamId, role: auth.role }
      const cur = periodRange(period.value, now)
      const prev = previousPeriodRange(period.value, now)
      const span = { start: prev.start, end: cur.end }
      const lookbackStart = dayKey(new Date(now.getTime() - PITCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000))
      const today = dayKey(now)

      const eventWindowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      const [activitySnap, leadSnap, wonSnap, lostSnap, recentWinsSnap, eventsSnap, hotSnap, waitingSnap] = await Promise.all([
        getDocs(await activitiesInDayRangeQuery(user, span)),
        getDocs(await leadsCreatedInDayRangeQuery(user, span)),
        getDocs(await dealsClosedInDayRangeQuery(user, { status: 'closed_won', ...span })),
        getDocs(await dealsClosedInDayRangeQuery(user, { status: 'closed_lost', ...span })),
        getDocs(await dealsClosedInDayRangeQuery(user, { status: 'closed_won', start: lookbackStart, end: today })),
        getDocs(await upcomingEventsQuery(user, { start: now, end: eventWindowEnd })),
        getDocs(await hotLeadsQuery(user)),
        getDocs(await neverContactedLeadsQuery(user)),
      ])
      if (seq !== loadSeq) return // a newer period switch overtook this one

      const data = {
        activities: activitySnap.docs.map(mapActivity),
        leads: leadSnap.docs.map((s) => ({ id: s.id, ...s.data() })),
        deals: [...wonSnap.docs, ...lostSnap.docs].map(mapDeal),
      }

      // The lists need the lead behind each deal (name, event) and that lead's other deals
      // (what is still open). One read per lead, capped, shared between the two lists.
      const wonInPeriod = data.deals
        .filter((d) => d.status === 'closed_won' && d.closedDayKey >= cur.start && d.closedDayKey <= cur.end)
        .sort((a, b) => (b.closedDayKey ?? '').localeCompare(a.closedDayKey ?? ''))
        .slice(0, MAX_CLOSED_LISTED)
      const pitchLeadIds = [...new Set(recentWinsSnap.docs.map(parentLeadId))].slice(0, MAX_PITCH_LEADS)
      const leadIds = [...new Set([...wonInPeriod.map((d) => d.leadId), ...pitchLeadIds])].filter(Boolean)

      const db = await getDb()
      const details = await Promise.all(leadIds.map(async (id) => {
        const [leadDoc, dealsSnap] = await Promise.all([
          getDoc(doc(db, 'leads', id)),
          getDocs(await leadDealsQuery(id)),
        ])
        return [id, leadDoc.exists() ? { id, ...leadDoc.data() } : null, dealsSnap.docs.map((s) => ({ id: s.id, ...s.data() }))]
      }))
      if (seq !== loadSeq) return

      const leadsById = new Map(details.filter(([, l]) => l).map(([id, l]) => [id, l]))
      const dealsByLead = new Map(details.map(([id, , deals]) => [id, deals]))

      range.value = cur
      previousRange.value = prev
      current.value = summarise(data, cur)
      previous.value = summarise(data, prev)
      series.value = bucketSeries(data, periodBuckets(period.value, cur))
      people.value = bySalesperson(data, cur)
      closedDeals.value = wonInPeriod
        .filter((d) => leadsById.has(d.leadId))
        .map((d) => ({
          deal: d,
          lead: leadsById.get(d.leadId),
          openProducts: (dealsByLead.get(d.leadId) ?? []).filter((x) => x.status === 'open').map((x) => x.productType),
        }))
      pitchList.value = pitchNext(
        new Map(pitchLeadIds.map((id) => [id, dealsByLead.get(id) ?? []])),
        leadsById,
        now,
      )
      upcomingEvents.value = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      hotLeads.value = hotSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      speed.value = {
        ...waitingForFirstContact(waitingSnap.docs.map((d) => ({ id: d.id, ...d.data() })), now),
        current: firstContactStats(data, cur),
        previous: firstContactStats(data, prev),
      }
      loaded.value = true
    } catch (err) {
      if (seq === loadSeq) error.value = err
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  function setPeriod(next) {
    if (!PERIODS.includes(next)) return
    period.value = next
    return load()
  }

  return {
    period, PERIODS, range, previousRange,
    current, previous, series, hasChart, people, closedDeals, pitchList,
    upcomingEvents, hotLeads, speed,
    loading, error, loaded,
    load, setPeriod,
  }
})
