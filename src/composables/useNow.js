/**
 * A reactive "now" — ticks on an interval, not just on data changes.
 *
 * Every date-derived computed in this app (urgency bands, day counts, the work queue's
 * Overdue/Today/Coming up buckets) reads `new Date()` or `Date.now()` imperatively. That is
 * NOT a reactive read: `computed()` only re-runs when one of the reactive values it touched
 * last time changes, so a lead correctly bucketed "Coming up" when the page loaded stays
 * there — even hours after its reminder time has actually passed — until something
 * unrelated (a new Firestore snapshot) forces a re-render. The work queue is "the most
 * important screen in the product" per its own docstring; silently stale urgency there is
 * exactly the P2 failure mode this whole product exists to prevent.
 *
 * Reading `now.value` inside a computed makes the interval itself the tracked dependency,
 * so the bucket/band recomputes on its own as the clock actually moves.
 *
 * 60s default: day/hour-level urgency does not need sub-minute precision, and ticking less
 * often matters for battery on a phone left open at a committee meeting (§11.3).
 */
import { ref, onScopeDispose } from 'vue'

export function useNow(intervalMs = 60_000) {
  const now = ref(new Date())
  const id = setInterval(() => {
    now.value = new Date()
  }, intervalMs)
  // onScopeDispose, not onUnmounted: a component's setup() runs inside an implicit effect
  // scope, so this still fires on unmount there — but it ALSO fires for a bare
  // effectScope().stop() with no component involved at all, which is what makes this
  // testable (and reusable from a Pinia store or anywhere else) without mounting a component
  // just to prove the interval gets cleared.
  onScopeDispose(() => clearInterval(id))
  return now
}
