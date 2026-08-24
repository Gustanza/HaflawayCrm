/**
 * Client-side pagination over an already-loaded, bounded set.
 *
 * Why client-side: the queries in services/queries.js cap at 100–500 documents, which is
 * the whole working set for one agent or one team. Paging in the browser keeps filters,
 * search and `priorityScore` sorting instant, and — importantly — avoids a Firestore
 * cursor that would have to be rebuilt every time a filter chip changes.
 *
 * When a single view genuinely outgrows one query, swap this for cursor pagination using
 * the `after` option the query builders already accept. The UI contract stays the same.
 */

import { computed, ref, watch, unref } from 'vue'

export const PAGE_SIZES = [25, 50, 100]

/**
 * The page numbers to render, with ellipses.
 *
 * Standard windowing: always show the first and last page, plus `delta` pages either side
 * of the current one, and collapse each gap to a single ellipsis. Returns numbers and the
 * strings 'gap-left' / 'gap-right' — distinct keys, because two entries keyed 'gap' in the
 * same v-for is a duplicate-key warning and an unstable DOM.
 *
 * `delta` is responsive at the call site: 0 on a phone (first … current … last, five
 * targets, all clearing 44px in 360px) and 2 on a wider screen.
 */
export function pageWindow(current, pageCount, delta = 1) {
  if (pageCount <= 1) return [1]

  // Small enough to show every page: no ellipsis, no arithmetic to get wrong.
  const maxWithoutGaps = delta * 2 + 5
  if (pageCount <= maxWithoutGaps) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }

  const start = Math.max(2, current - delta)
  const end = Math.min(pageCount - 1, current + delta)
  const pages = [1]

  // Left gap covers pages 2 .. start-1. Collapse it ONLY when it hides two or more —
  // an ellipsis standing in for a single page costs the reader a destination and saves
  // no space at all. (Caught by property test: current=3, pageCount=6, delta=0.)
  if (start >= 4) pages.push('gap-left')
  else for (let p = 2; p < start; p += 1) pages.push(p)

  for (let p = start; p <= end; p += 1) {
    if (p !== 1 && p !== pageCount) pages.push(p)
  }

  // Right gap covers pages end+1 .. pageCount-1, same rule.
  if (end <= pageCount - 3) pages.push('gap-right')
  else for (let p = end + 1; p <= pageCount - 1; p += 1) pages.push(p)

  pages.push(pageCount)
  return pages
}

export function usePagination(source, { pageSize = 25 } = {}) {
  const page = ref(1)
  const perPage = ref(pageSize)

  const all = computed(() => unref(source) ?? [])
  const total = computed(() => all.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))

  // A filter change can leave you stranded on page 7 of 3, staring at an empty list and
  // assuming there are no results.
  watch([total, perPage], () => {
    if (page.value > pageCount.value) page.value = pageCount.value
  })

  const start = computed(() => (page.value - 1) * perPage.value)
  const items = computed(() => all.value.slice(start.value, start.value + perPage.value))

  const from = computed(() => (total.value === 0 ? 0 : start.value + 1))
  const to = computed(() => Math.min(start.value + perPage.value, total.value))

  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => page.value < pageCount.value)

  function go(next) {
    page.value = Math.min(Math.max(1, next), pageCount.value)
  }

  const prev = () => go(page.value - 1)
  const next = () => go(page.value + 1)
  const reset = () => (page.value = 1)

  function setPerPage(size) {
    // Keep the first visible row visible across a page-size change, rather than throwing
    // the user back to the top of the list.
    const anchor = start.value
    perPage.value = size
    page.value = Math.floor(anchor / size) + 1
  }

  /** Page numbers plus ellipsis markers, for a numbered paginator. */
  const windowFor = (delta = 1) => pageWindow(page.value, pageCount.value, delta)

  return {
    page, perPage, items, total, pageCount, from, to, hasPrev, hasNext,
    go, prev, next, reset, setPerPage, windowFor,
  }
}
