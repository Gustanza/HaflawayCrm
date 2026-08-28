import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useNow } from '../../src/composables/useNow.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('starts at the current time', () => {
    const start = new Date('2026-08-27T10:00:00Z')
    vi.setSystemTime(start)
    const scope = effectScope()
    let now
    scope.run(() => {
      now = useNow()
    })
    expect(now.value.getTime()).toBe(start.getTime())
    scope.stop()
  })

  it('advances on its own as time passes, with no external trigger', () => {
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))
    const scope = effectScope()
    let now
    scope.run(() => {
      now = useNow(60_000)
    })

    const first = now.value.getTime()
    vi.advanceTimersByTime(60_000)
    expect(now.value.getTime()).toBe(first + 60_000)

    vi.advanceTimersByTime(3 * 60_000)
    expect(now.value.getTime()).toBe(first + 4 * 60_000)

    scope.stop()
  })

  it('stops ticking once its owning scope is disposed — no leaked interval', () => {
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))
    const scope = effectScope()
    let now
    scope.run(() => {
      now = useNow(60_000)
    })

    const first = now.value.getTime()
    scope.stop() // triggers onUnmounted's cleanup, same as a component unmounting

    vi.advanceTimersByTime(5 * 60_000)
    expect(now.value.getTime()).toBe(first) // unchanged — the interval was cleared
  })
})
