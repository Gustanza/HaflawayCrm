/**
 * BarChart.vue — the shared component that replaced DashboardView.vue's hand-rolled
 * div-bar trend/funnel visuals. Two things must hold for either orientation:
 *   1. Bar size (height for vertical, width for horizontal) is proportional to the item's
 *      value relative to the largest value in the set.
 *   2. Every bar carries an accessible label (role="img" + aria-label with the value spelled
 *      out) — this is the "no info is chart-only" guarantee the dataviz skill's
 *      accessibility pass requires.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BarChart from '../../src/components/ui/BarChart.vue'

const ITEMS = [
  { key: 'a', label: 'A', value: 10, direct: '10' },
  { key: 'b', label: 'B', value: 40, direct: '40' },
  { key: 'c', label: 'C', value: 20, direct: '20' },
]

describe('BarChart', () => {
  it('vertical: bar heights are proportional to value, tallest bar hits 100%', () => {
    const wrapper = mount(BarChart, {
      props: { items: ITEMS, orientation: 'vertical', ariaLabel: 'Test trend' },
    })

    const bars = wrapper.findAll('[role="img"][aria-label^="A:"], [role="img"][aria-label^="B:"], [role="img"][aria-label^="C:"]')
    expect(bars.length).toBe(3)

    const heightOf = (label) =>
      Number(
        wrapper
          .findAll('[role="img"]')
          .find((b) => b.attributes('aria-label').startsWith(`${label}:`))
          .attributes('style')
          .match(/height:\s*(\d+)%/)[1],
      )

    expect(heightOf('B')).toBe(100) // max value (40) fills the full track
    expect(heightOf('A')).toBe(25) // 10/40
    expect(heightOf('C')).toBe(50) // 20/40
  })

  it('horizontal: bar widths are proportional to value, tallest bar hits 100%', () => {
    const wrapper = mount(BarChart, {
      props: { items: ITEMS, orientation: 'horizontal', ariaLabel: 'Test funnel' },
    })

    const widthOf = (label) =>
      Number(
        wrapper
          .findAll('[role="img"]')
          .find((b) => b.attributes('aria-label').startsWith(`${label}:`))
          .attributes('style')
          .match(/width:\s*(\d+)%/)[1],
      )

    expect(widthOf('B')).toBe(100)
    expect(widthOf('A')).toBe(25)
    expect(widthOf('C')).toBe(50)
  })

  it('every bar has an accessible label naming the item and its formatted value', () => {
    const wrapper = mount(BarChart, {
      props: {
        items: ITEMS,
        orientation: 'vertical',
        valueFormatter: (v) => `${v} units`,
        ariaLabel: 'Test',
      },
    })

    for (const item of ITEMS) {
      const bar = wrapper
        .findAll('[role="img"]')
        .find((b) => b.attributes('aria-label') === `${item.label}: ${item.value} units`)
      expect(bar, `no accessible bar found for ${item.label}`).toBeTruthy()
    }
  })

  it('a zero-value item still renders a (near-invisible) bar rather than nothing', () => {
    const items = [...ITEMS, { key: 'z', label: 'Z', value: 0, direct: '0' }]
    const wrapper = mount(BarChart, { props: { items, orientation: 'vertical', ariaLabel: 'Test' } })

    const zeroBar = wrapper.findAll('[role="img"]').find((b) => b.attributes('aria-label').startsWith('Z:'))
    expect(zeroBar).toBeTruthy()
    expect(zeroBar.attributes('style')).toContain('height: 2px')
  })
})
