/**
 * Firestore reads with a managed lifecycle.
 *
 * TODO.md §11.3 — read-cost discipline. At 50 users, careless listeners are the main cost
 * and the main battery drain, so:
 *   - every listener unsubscribes on unmount, enforced HERE rather than trusted to each
 *     component (a leaked onSnapshot keeps billing after the user has navigated away)
 *   - real-time is opt-in, not the default; most screens want a one-shot read
 *   - snapshot metadata is fed to the ui store so the offline indicator tells the truth (P8)
 *
 * Queries must come from `src/services/queries.js`. Security rules are not filters: a
 * hand-rolled query that omits `orgId` is rejected outright on a list. See that file.
 */

import { ref, shallowRef, onUnmounted, computed } from 'vue'
import { onSnapshot, getDocs } from 'firebase/firestore'
import { useUiStore } from '@/stores/ui.js'

const withId = (snap) => ({ id: snap.id, ...snap.data() })

/**
 * Load a collection once, or subscribe to it.
 *
 * @param buildQuery  async (after?) => Query — usually a builder from services/queries.js.
 *                    The optional `after` cursor is only ever passed by loadMore() below;
 *                    a builder that ignores its argument (every existing one) keeps working
 *                    unchanged.
 * @param options.live      subscribe instead of one-shot (default false)
 * @param options.immediate load on creation (default true)
 * @param options.map       transform each document
 * @param options.pageSize  the LIMIT the query itself uses. Supplying it is what turns on
 *                          `hasMore`/`loadMore()` — omitted, this composable behaves exactly
 *                          as before. It cannot be inferred from the query object itself, so
 *                          the caller states it explicitly (and must keep it in sync with
 *                          whatever `max`/`limit` the query builder was actually given).
 */
export function useCollection(
  buildQuery,
  { live = false, immediate = true, map = withId, pageSize = null } = {},
) {
  const items = shallowRef([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref(null)
  const loaded = ref(false)
  const fromCache = ref(false)
  const hasMore = ref(false)

  const ui = useUiStore()
  let unsubscribe = null
  // The raw last doc from the most recent fetch — a cursor, never exposed via `items`
  // (which stays the mapped `{id, ...data}` shape every caller already expects).
  let lastDoc = null

  /** True only once we know there is genuinely nothing — not while still loading. */
  const isEmpty = computed(() => loaded.value && items.value.length === 0)

  function stop() {
    unsubscribe?.()
    unsubscribe = null
  }

  /** An exact-cap fetch means there might be more — Firestore has no cheap total count. */
  function updateHasMore(fetchedCount) {
    hasMore.value = pageSize != null && fetchedCount === pageSize
  }

  async function load() {
    loading.value = true
    error.value = null
    lastDoc = null
    hasMore.value = false
    stop()

    try {
      const q = await buildQuery()
      if (!q) {
        // A builder can legitimately decline — e.g. a role with no access to this list.
        items.value = []
        loaded.value = true
        return
      }

      if (live) {
        await new Promise((resolve, reject) => {
          let settled = false
          unsubscribe = onSnapshot(
            q,
            { includeMetadataChanges: true },
            (snap) => {
              ui.reportSnapshot(snap)
              fromCache.value = snap.metadata.fromCache
              items.value = snap.docs.map(map)
              // Meaningful even though loadMore() refuses to run on a live query (see
              // there): an exact-cap snapshot still means more COULD exist beyond the
              // limit, and a view is entitled to say so even if it can't fetch them.
              // `lastDoc` deliberately stays null — a live listener has no stable cursor.
              updateHasMore(snap.docs.length)
              loaded.value = true
              loading.value = false
              if (!settled) {
                settled = true
                resolve()
              }
            },
            (err) => {
              error.value = err
              loading.value = false
              if (!settled) {
                settled = true
                reject(err)
              }
            },
          )
        })
      } else {
        const snap = await getDocs(q)
        ui.reportSnapshot(snap)
        fromCache.value = snap.metadata.fromCache
        items.value = snap.docs.map(map)
        lastDoc = snap.docs[snap.docs.length - 1] ?? null
        updateHasMore(snap.docs.length)
        loaded.value = true
      }
    } catch (err) {
      error.value = err
      // Offline with a cold cache is expected, not exceptional — the banner already says so.
      if (err?.code !== 'unavailable') {
        // eslint-disable-next-line no-console
        console.error('[useCollection]', err)
      }
    } finally {
      if (!live) loading.value = false
    }
  }

  /**
   * Fetch the next page and APPEND it — never available on a live listener (a live query
   * has no stable cursor once anything in the collection changes underneath it) or before
   * the first page has actually loaded.
   */
  async function loadMore() {
    if (live || !hasMore.value || loadingMore.value || !lastDoc) return
    loadingMore.value = true
    error.value = null
    try {
      const q = await buildQuery(lastDoc)
      if (!q) return
      const snap = await getDocs(q)
      ui.reportSnapshot(snap)
      items.value = [...items.value, ...snap.docs.map(map)]
      lastDoc = snap.docs[snap.docs.length - 1] ?? lastDoc
      updateHasMore(snap.docs.length)
    } catch (err) {
      error.value = err
      if (err?.code !== 'unavailable') {
        // eslint-disable-next-line no-console
        console.error('[useCollection loadMore]', err)
      }
    } finally {
      loadingMore.value = false
    }
  }

  // Enforced here so no component can forget it (§11.3).
  onUnmounted(stop)

  if (immediate) load()

  return {
    items, loading, loadingMore, error, loaded, isEmpty, fromCache, hasMore,
    load, loadMore, stop,
  }
}

/** A single document. Same lifecycle guarantees. */
export function useDoc(buildRef, { live = true, immediate = true } = {}) {
  const item = shallowRef(null)
  const loading = ref(false)
  const error = ref(null)
  const loaded = ref(false)

  const ui = useUiStore()
  let unsubscribe = null

  function stop() {
    unsubscribe?.()
    unsubscribe = null
  }

  async function load() {
    loading.value = true
    error.value = null
    stop()

    try {
      const reference = await buildRef()
      if (!reference) {
        item.value = null
        loaded.value = true
        return
      }

      if (live) {
        unsubscribe = onSnapshot(
          reference,
          { includeMetadataChanges: true },
          (snap) => {
            ui.reportSnapshot(snap)
            item.value = snap.exists() ? withId(snap) : null
            loaded.value = true
            loading.value = false
          },
          (err) => {
            error.value = err
            loading.value = false
          },
        )
      } else {
        const { getDoc } = await import('firebase/firestore')
        const snap = await getDoc(reference)
        item.value = snap.exists() ? withId(snap) : null
        loaded.value = true
      }
    } catch (err) {
      error.value = err
    } finally {
      if (!live) loading.value = false
    }
  }

  onUnmounted(stop)
  if (immediate) load()

  return { item, loading, error, loaded, load, stop }
}
