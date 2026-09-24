/**
 * Global UI state: toasts, connectivity, and the pending-write indicator.
 *
 * TODO.md P8: writes are optimistic and the app stays usable offline. That only works if
 * the user can TRUST it — so we show honest, quiet status rather than a spinner:
 * "Offline — 3 changes will sync" is reassuring; a frozen save button is not.
 *
 * HONESTY CAVEAT, worth understanding before you extend this:
 * `navigator.onLine` is not a connectivity check. On Android it reports true for any
 * attached interface — a dead EDGE bar in a wedding hall, or a captive-portal Wi-Fi that
 * has not been logged into. It is a useful NEGATIVE signal (false really does mean
 * offline) and an unreliable positive one. The authoritative source is Firestore's own
 * snapshot metadata, which is why `reportSnapshot()` exists: any live listener should
 * feed its snapshots into it, and that outranks navigator.onLine.
 *
 * But `fromCache` is NOT an offline signal on its own. Every live listener opens with a
 * cached snapshot and only then hears from the server — normally a few hundred ms later.
 * Treating that first snapshot as "offline" flashed the banner on every screen, and a
 * listener that errored or unmounted before the server answered latched it on for good.
 * So each listener is tracked separately, a cached snapshot only counts once it has gone
 * unanswered for CACHE_GRACE_MS, and any server-served snapshot proves we are connected.
 */

import { defineStore } from 'pinia'
import { ref, computed, readonly } from 'vue'
import i18n from '@/i18n.js'

let nextToastId = 0
let nextSourceId = 0

/** Firestore itself gives up on the backend after ~10 s; matching it avoids false alarms. */
const CACHE_GRACE_MS = 10_000

/**
 * Firestore error codes → locale keys.
 *
 * §16 Definition of Done: "Errors surface a human message, not a Firebase error code."
 * The default write path used to print the SDK's own English string — "Missing or
 * insufficient permissions." — at a Swahili-speaking agent whose stage change was rejected
 * by rules, with no indication of what to do next.
 */
const WRITE_ERRORS = {
  'permission-denied': 'errors.write.permissionDenied',
  unauthenticated: 'errors.write.unauthenticated',
  unavailable: 'errors.write.unavailable',
  'deadline-exceeded': 'errors.write.unavailable',
  'not-found': 'errors.write.notFound',
  'already-exists': 'errors.write.alreadyExists',
  'failed-precondition': 'errors.write.failedPrecondition',
  'resource-exhausted': 'errors.write.unavailable',
  'invalid-argument': 'errors.write.invalidArgument',
  'duplicate-lead': 'errors.write.duplicateLead',
  'invalid-phone': 'errors.write.invalidPhone',
}

export function writeErrorKey(error) {
  return WRITE_ERRORS[error?.code] ?? 'errors.write.generic'
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref([])
  const browserOnline = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  // Listeners whose cached snapshot has gone unanswered by the server past the grace period.
  const staleSources = ref(new Set())
  const graceTimers = new Map()
  const pendingWrites = ref(0)
  const sidebarOpen = ref(false)
  const justReconnected = ref(false)

  /**
   * Offline if EITHER signal says so. The browser flag catches an aeroplane-mode toggle
   * instantly; Firestore's cache flag catches the connected-but-useless cases the browser
   * flag misses.
   */
  const isOnline = computed(() => browserOnline.value && staleSources.value.size === 0)
  const hasPendingWrites = computed(() => pendingWrites.value > 0)

  function clearSource(source) {
    clearTimeout(graceTimers.get(source))
    graceTimers.delete(source)
    if (staleSources.value.has(source)) {
      const next = new Set(staleSources.value)
      next.delete(source)
      staleSources.value = next
    }
  }

  function clearAllSources() {
    for (const timer of graceTimers.values()) clearTimeout(timer)
    graceTimers.clear()
    if (staleSources.value.size) staleSources.value = new Set()
  }

  /**
   * Feed Firestore snapshot metadata in from any listener:
   *   const source = ui.connectivitySource()
   *   onSnapshot(q, { includeMetadataChanges: true }, (snap) => ui.reportSnapshot(snap, source))
   *   ...and ui.releaseSource(source) when that listener stops or errors.
   *
   * One-shot reads can omit `source`; they share a single slot.
   */
  function reportSnapshot(snapshot, source = 'one-shot') {
    const meta = snapshot?.metadata
    if (!meta) return
    if (!meta.fromCache) {
      // A server answer from ANY listener proves the connection is up.
      clearAllSources()
      return
    }
    if (graceTimers.has(source) || staleSources.value.has(source)) return
    graceTimers.set(
      source,
      setTimeout(() => {
        graceTimers.delete(source)
        staleSources.value = new Set(staleSources.value).add(source)
      }, CACHE_GRACE_MS),
    )
    // NOTE: `hasPendingWrites` is PER-QUERY metadata, not a global truth. Using it to set
    // the counter let an unrelated snapshot (say the profile listener) report "nothing
    // queued" while three lead writes were still waiting. trackWrite() owns the counter.
  }

  /** A token identifying one live listener to reportSnapshot(). */
  function connectivitySource() {
    return `listener-${++nextSourceId}`
  }

  /** The listener stopped or errored — its last cached snapshot no longer says anything. */
  const releaseSource = clearSource

  /* ------------------------------------------------------------------- toasts */

  function toast(message, { type = 'info', timeout = 4000, action = null } = {}) {
    const id = ++nextToastId
    toasts.value.push({ id, message, type, action })
    if (timeout > 0) setTimeout(() => dismiss(id), timeout)

    // Keep the stack shallow — a column of toasts over a phone screen buries the content —
    // but NEVER evict an error. Errors are timeout:0 precisely so they persist, and a
    // plain shift() dropped the failed-save warning as soon as three successes followed it.
    if (toasts.value.length > 3) {
      const victim = toasts.value.find((t) => t.type !== 'error')
      if (victim) dismiss(victim.id)
    }
    return id
  }

  const success = (m, o) => toast(m, { ...o, type: 'success' })
  const info = (m, o) => toast(m, { ...o, type: 'info' })
  const warn = (m, o) => toast(m, { timeout: 6000, ...o, type: 'warning' })

  /** Errors persist until dismissed — an agent must not miss a failed save. */
  const error = (m, o) => toast(m, { timeout: 0, ...o, type: 'error' })

  function dismiss(id) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function clearToasts() {
    toasts.value = []
  }

  /* -------------------------------------------------------------------- writes */

  /**
   * Track a write WITHOUT awaiting it.
   *
   * A Firestore write promise does not settle while offline — it resolves only on server
   * acknowledgement. So `await ui.trackWrite(setDoc(...))` would sit on that await
   * indefinitely at a committee meeting with no signal, leaving the save button spinning:
   * exactly the thing P8 forbids.
   *
   * The local write has already applied to the cache by the time this returns, so callers
   * should navigate optimistically and let the count report what is still in flight.
   *
   * Returns the original promise for anyone who genuinely needs server confirmation —
   * a month-close, say. Do not await it in a normal submit handler.
   */
  function trackWrite(promise, { onError } = {}) {
    pendingWrites.value += 1
    promise
      .then(() => {
        pendingWrites.value = Math.max(0, pendingWrites.value - 1)
      })
      .catch((err) => {
        pendingWrites.value = Math.max(0, pendingWrites.value - 1)
        if (onError) onError(err)
        else error(i18n.global.t(writeErrorKey(err)))
      })
    return promise
  }

  /* -------------------------------------------------------------- connectivity */

  function bindConnectivity() {
    if (typeof window === 'undefined') return () => {}

    const goOnline = () => {
      browserOnline.value = true
      // Clear the Firestore-side flag too. Without this, the Firestore-side flag could only ever
      // be set FALSE, so after a single signal drop `isOnline` latched false for the whole
      // session: the agent walked back into 4G and the app still said "Huna mtandao".
      // A false negative is worse than the false positive it replaced — an agent who
      // stops trusting the indicator stops trusting that their notes were saved.
      // The next snapshot corrects this if we are wrong.
      clearAllSources()
      justReconnected.value = true
      setTimeout(() => {
        justReconnected.value = false
      }, 4000)
    }
    const goOffline = () => {
      browserOnline.value = false
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }

  function toggleSidebar(force) {
    sidebarOpen.value = force ?? !sidebarOpen.value
  }

  return {
    toasts: readonly(toasts),
    isOnline,
    justReconnected: readonly(justReconnected),
    pendingWrites: readonly(pendingWrites),
    hasPendingWrites,
    sidebarOpen,
    toast, success, info, warn, error, dismiss, clearToasts,
    trackWrite, reportSnapshot, connectivitySource, releaseSource, bindConnectivity, toggleSidebar,
  }
})
