/**
 * Pagination behaviour.
 *
 * The interesting cases are all about NOT stranding the user: a filter that shrinks the
 * result set while they are on page 7, a page-size change that would otherwise throw them
 * back to the top, and an empty set that must not report "showing 1-0 of 0".
 */
import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { usePagination, pageWindow, PAGE_SIZES } from '../../src/composables/usePagination.js'

const range = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

describe('paging a fixed set', () => {
  it('slices the first page', () => {
    const p = usePagination(ref(range(60)), { pageSize: 25 })
    expect(p.items.value).toHaveLength(25)
    expect(p.items.value[0].id).toBe(1)
    expect(p.pageCount.value).toBe(3)
    expect(p.from.value).toBe(1)
    expect(p.to.value).toBe(25)
  })

  it('walks forward and back', () => {
    const p = usePagination(ref(range(60)), { pageSize: 25 })

    p.next()
    expect(p.page.value).toBe(2)
    expect(p.items.value[0].id).toBe(26)
    expect(p.from.value).toBe(26)
    expect(p.to.value).toBe(50)

    p.next()
    expect(p.page.value).toBe(3)
    expect(p.items.value).toHaveLength(10) // the short last page
    expect(p.to.value).toBe(60)

    p.prev()
    expect(p.page.value).toBe(2)
  })

  it('clamps rather than running off either end', () => {
    const p = usePagination(ref(range(30)), { pageSize: 25 })
    p.prev()
    expect(p.page.value).toBe(1)
    expect(p.hasPrev.value).toBe(false)

    p.go(999)
    expect(p.page.value).toBe(2)
    expect(p.hasNext.value).toBe(false)
  })
})

describe('an empty or tiny set', () => {
  it('reports 0-0 of 0 rather than 1-0', () => {
    const p = usePagination(ref([]), { pageSize: 25 })
    expect(p.items.value).toEqual([])
    expect(p.total.value).toBe(0)
    expect(p.from.value).toBe(0)
    expect(p.to.value).toBe(0)
    // Always at least one page, so the control never renders "Page 1/0".
    expect(p.pageCount.value).toBe(1)
    expect(p.hasNext.value).toBe(false)
  })

  it('handles a set smaller than one page', () => {
    const p = usePagination(ref(range(3)), { pageSize: 25 })
    expect(p.pageCount.value).toBe(1)
    expect(p.to.value).toBe(3)
  })

  it('survives a null or undefined source', () => {
    expect(usePagination(ref(null)).items.value).toEqual([])
    expect(usePagination(ref(undefined)).total.value).toBe(0)
  })
})

describe('the source shrinking underneath — the filter case', () => {
  it('pulls the user back to the last real page instead of showing nothing', async () => {
    // The bug this guards: filter to 2 results while on page 7, and the list renders empty
    // while quietly claiming there are matches. The user concludes there are none.
    const source = ref(range(200))
    const p = usePagination(source, { pageSize: 25 })

    p.go(7)
    expect(p.page.value).toBe(7)

    source.value = range(30)
    await Promise.resolve() // let the watcher settle

    expect(p.pageCount.value).toBe(2)
    expect(p.page.value).toBe(2)
    expect(p.items.value.length).toBeGreaterThan(0)
  })

  it('lands on page 1 when the set empties entirely', async () => {
    const source = ref(range(80))
    const p = usePagination(source, { pageSize: 25 })
    p.go(4)

    source.value = []
    await Promise.resolve()

    expect(p.page.value).toBe(1)
    expect(p.items.value).toEqual([])
  })

  it('reset() returns to page 1 for a filter change', () => {
    const p = usePagination(ref(range(200)), { pageSize: 25 })
    p.go(5)
    p.reset()
    expect(p.page.value).toBe(1)
  })
})

describe('changing the page size', () => {
  it('keeps the first visible row visible rather than jumping to the top', async () => {
    const p = usePagination(ref(range(200)), { pageSize: 25 })
    p.go(3) // rows 51-75

    p.setPerPage(50)
    await Promise.resolve()

    // Row 51 must still be on screen: it is what the user was looking at.
    expect(p.items.value.some((item) => item.id === 51)).toBe(true)
    expect(p.perPage.value).toBe(50)
  })

  it('offers the documented sizes', () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100])
  })

  it('never leaves the page beyond the new page count', async () => {
    const p = usePagination(ref(range(60)), { pageSize: 25 })
    p.go(3)
    p.setPerPage(100)
    await Promise.resolve()
    expect(p.page.value).toBeLessThanOrEqual(p.pageCount.value)
    expect(p.items.value).toHaveLength(60)
  })
})

describe('works with a computed source, which is how the views use it', () => {
  it('follows a filtered computed', async () => {
    const all = ref(range(100))
    const term = ref(0)
    const filtered = computed(() => all.value.filter((item) => item.id > term.value))
    const p = usePagination(filtered, { pageSize: 25 })

    expect(p.total.value).toBe(100)

    term.value = 90
    await Promise.resolve()

    expect(p.total.value).toBe(10)
    expect(p.pageCount.value).toBe(1)
  })

  it('never returns more rows than the page size', () => {
    for (const size of PAGE_SIZES) {
      const p = usePagination(ref(range(500)), { pageSize: size })
      expect(p.items.value.length).toBeLessThanOrEqual(size)
    }
  })

  it('every row appears on exactly one page', () => {
    const p = usePagination(ref(range(97)), { pageSize: 25 })
    const seen = new Set()
    for (let page = 1; page <= p.pageCount.value; page += 1) {
      p.go(page)
      for (const item of p.items.value) {
        expect(seen.has(item.id), `id ${item.id} appeared twice`).toBe(false)
        seen.add(item.id)
      }
    }
    expect(seen.size).toBe(97)
  })
})

describe('pageWindow — the numbered paginator', () => {
  it('shows every page when they all fit', () => {
    expect(pageWindow(1, 1, 1)).toEqual([1])
    expect(pageWindow(2, 5, 1)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindow(4, 7, 1)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('always includes the first and last page', () => {
    for (const current of [1, 5, 10, 15, 20]) {
      const w = pageWindow(current, 20, 1)
      expect(w[0], `current=${current}`).toBe(1)
      expect(w.at(-1), `current=${current}`).toBe(20)
    }
  })

  it('always includes the current page', () => {
    for (let current = 1; current <= 20; current += 1) {
      expect(pageWindow(current, 20, 1), `current=${current}`).toContain(current)
    }
  })

  it('collapses distant runs to a single ellipsis', () => {
    expect(pageWindow(10, 20, 1)).toEqual([1, 'gap-left', 9, 10, 11, 'gap-right', 20])
    expect(pageWindow(1, 20, 1)).toEqual([1, 2, 'gap-right', 20])
    expect(pageWindow(20, 20, 1)).toEqual([1, 'gap-left', 19, 20])
  })

  it('never hides exactly one page behind an ellipsis', () => {
    // A gap standing in for a single page costs the reader a destination and saves nothing.
    for (let pageCount = 1; pageCount <= 40; pageCount += 1) {
      for (let current = 1; current <= pageCount; current += 1) {
        for (const delta of [0, 1, 2]) {
          const w = pageWindow(current, pageCount, delta)
          const numbers = w.filter((x) => typeof x === 'number')
          for (let i = 1; i < w.length; i += 1) {
            if (typeof w[i] !== 'string') continue
            const before = w[i - 1]
            const after = w[i + 1]
            if (typeof before === 'number' && typeof after === 'number') {
              expect(
                after - before,
                `gap hides ${after - before - 1} page(s) at cur=${current}/${pageCount} d=${delta}`,
              ).toBeGreaterThan(2)
            }
          }
          // And the numbers must be strictly ascending with no repeats.
          expect(numbers, `cur=${current}/${pageCount} d=${delta}`).toEqual(
            [...new Set(numbers)].sort((a, b) => a - b),
          )
        }
      }
    }
  })

  it('gives distinct keys to the two ellipses', () => {
    const w = pageWindow(10, 20, 1)
    const gaps = w.filter((x) => typeof x === 'string')
    expect(new Set(gaps).size, 'two entries keyed the same breaks v-for').toBe(gaps.length)
  })

  it('narrows on mobile and widens on desktop', () => {
    // delta 0 keeps five targets, all of which clear 44px inside 360px.
    expect(pageWindow(10, 20, 0).length).toBeLessThanOrEqual(5)
    expect(pageWindow(10, 20, 2).length).toBeGreaterThan(pageWindow(10, 20, 0).length)
  })

  it('is exposed from usePagination via windowFor', () => {
    const p = usePagination(ref(range(200)), { pageSize: 25 })
    p.go(4)
    expect(p.windowFor(1)).toContain(4)
    expect(p.windowFor(1)[0]).toBe(1)
    expect(p.windowFor(1).at(-1)).toBe(8)
  })
})
