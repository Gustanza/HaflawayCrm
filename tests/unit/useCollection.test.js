/**
 * useCollection's loadMore()/hasMore — the cursor-pagination extension.
 *
 * Existing behaviour (load/live/error handling) is exercised indirectly by every view
 * that already used this composable before pageSize/hasMore/loadMore existed; this file
 * targets only the new surface, with a fake `getDocs` standing in for Firestore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDocs, onSnapshot } from 'firebase/firestore'
import { useCollection } from '../../src/composables/useCollection.js'

vi.mock('@/stores/ui.js', () => ({
  useUiStore: () => ({ reportSnapshot: vi.fn() }),
}))

vi.mock('firebase/firestore', () => ({
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
}))

/** A fake QueryDocumentSnapshot — only `.id`/`.data()` are ever read by useCollection. */
function fakeDoc(id, data = {}) {
  return { id, data: () => data }
}

/** A fake Firestore snapshot — just what `getDocs` results need to expose. */
function fakeSnapshot(docs) {
  return { docs, metadata: { fromCache: false } }
}

beforeEach(() => {
  getDocs.mockReset()
  onSnapshot.mockReset()
})

describe('useCollection — hasMore/loadMore', () => {
  it('hasMore is false when the fetch returns fewer than pageSize', async () => {
    getDocs.mockResolvedValueOnce(fakeSnapshot([fakeDoc('a'), fakeDoc('b')]))
    const { loaded, hasMore, items } = useCollection(() => ({}), { pageSize: 5 })

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(items.value.map((i) => i.id)).toEqual(['a', 'b'])
    expect(hasMore.value).toBe(false)
  })

  it('hasMore is true when the fetch returns exactly pageSize — an exact cap might hide more', async () => {
    getDocs.mockResolvedValueOnce(fakeSnapshot([fakeDoc('a'), fakeDoc('b'), fakeDoc('c')]))
    const { loaded, hasMore } = useCollection(() => ({}), { pageSize: 3 })

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(hasMore.value).toBe(true)
  })

  it('loadMore() appends the next page rather than replacing items, and passes the last doc as a cursor', async () => {
    getDocs
      .mockResolvedValueOnce(fakeSnapshot([fakeDoc('a'), fakeDoc('b')]))
      .mockResolvedValueOnce(fakeSnapshot([fakeDoc('c')]))

    const buildQuery = vi.fn((after) => ({ after: after ?? null }))
    const { loaded, hasMore, items, loadMore, loadingMore } = useCollection(buildQuery, {
      pageSize: 2,
    })

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(items.value.map((i) => i.id)).toEqual(['a', 'b'])
    expect(hasMore.value).toBe(true) // fetched exactly pageSize=2

    await loadMore()

    expect(loadingMore.value).toBe(false)
    expect(items.value.map((i) => i.id)).toEqual(['a', 'b', 'c']) // appended, not replaced
    expect(hasMore.value).toBe(false) // second page (1 doc) is short of pageSize=2

    // buildQuery's second call received the cursor doc from the first page's last item.
    expect(buildQuery).toHaveBeenCalledTimes(2)
    expect(buildQuery.mock.calls[0]).toEqual([])
    expect(buildQuery.mock.calls[1][0]).toMatchObject({ id: 'b' })
  })

  it('loadMore() is a no-op when hasMore is false — no extra Firestore call', async () => {
    getDocs.mockResolvedValueOnce(fakeSnapshot([fakeDoc('a')]))
    const { loaded, hasMore, loadMore } = useCollection(() => ({}), { pageSize: 5 })

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(hasMore.value).toBe(false)

    await loadMore()
    expect(getDocs).toHaveBeenCalledTimes(1) // only the initial load, loadMore did nothing
  })

  it('without pageSize, hasMore stays false regardless of fetch size — existing callers are unaffected', async () => {
    getDocs.mockResolvedValueOnce(fakeSnapshot([fakeDoc('a'), fakeDoc('b'), fakeDoc('c')]))
    const { loaded, hasMore } = useCollection(() => ({})) // no pageSize option at all

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(hasMore.value).toBe(false)
  })

  it('a LIVE listener still reports hasMore honestly, but loadMore() refuses to run', async () => {
    // WorkQueueView.vue uses { live: true } deliberately (a completed follow-up must
    // disappear immediately). A live query has no stable cursor once anything in the
    // collection changes underneath it, so loadMore() is a no-op there by design — but the
    // view is still entitled to know (and say) that its cap might be hiding more.
    onSnapshot.mockImplementation((_q, _opts, onNext) => {
      onNext(fakeSnapshot([fakeDoc('a'), fakeDoc('b')]))
      return () => {}
    })
    const { loaded, hasMore, loadMore } = useCollection(() => ({}), {
      live: true,
      pageSize: 2,
    })

    await vi.waitFor(() => expect(loaded.value).toBe(true))
    expect(hasMore.value).toBe(true) // fetched exactly pageSize=2 — honest, even though live

    await loadMore()
    expect(getDocs).not.toHaveBeenCalled() // refused — no cursor exists for a live query
  })
})
