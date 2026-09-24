import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/i18n.js', () => ({ default: { global: { t: (k) => k } } }))

import { useUiStore } from '@/stores/ui.js'

const snap = (fromCache) => ({ metadata: { fromCache } })

describe('ui store — offline indicator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('does not flash offline for the cached snapshot every listener opens with', () => {
    const ui = useUiStore()
    const source = ui.connectivitySource()
    ui.reportSnapshot(snap(true), source)
    vi.advanceTimersByTime(500)
    ui.reportSnapshot(snap(false), source)
    vi.advanceTimersByTime(20_000)
    expect(ui.isOnline).toBe(true)
  })

  it('goes offline when the server stays silent past the grace period', () => {
    const ui = useUiStore()
    ui.reportSnapshot(snap(true), ui.connectivitySource())
    vi.advanceTimersByTime(10_001)
    expect(ui.isOnline).toBe(false)
  })

  it('does not latch offline when a listener errors or unmounts before the server answers', () => {
    const ui = useUiStore()
    const source = ui.connectivitySource()
    ui.reportSnapshot(snap(true), source)
    ui.releaseSource(source)
    vi.advanceTimersByTime(20_000)
    expect(ui.isOnline).toBe(true)
  })

  it('recovers as soon as any listener hears from the server', () => {
    const ui = useUiStore()
    ui.reportSnapshot(snap(true), ui.connectivitySource())
    vi.advanceTimersByTime(10_001)
    expect(ui.isOnline).toBe(false)
    ui.reportSnapshot(snap(false), ui.connectivitySource())
    expect(ui.isOnline).toBe(true)
  })
})
