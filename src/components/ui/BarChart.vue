<script setup>
/**
 * A minimal single-series bar chart — one hue, magnitude only, no dual axis (dataviz
 * skill's non-negotiables). Used for both the CAC dashboard's revenue trend (vertical
 * columns) and its funnel (horizontal rows) rather than duplicating the same mark logic
 * twice. Every bar is directly labeled — at 5-6 points that's the right call, not the
 * "a number on every point" anti-pattern that applies to dense charts.
 *
 * Plain HTML + CSS, not SVG: percentage-height/width fills are simpler to keep correct
 * across the two orientations and trivial to unit-test (inline style is real DOM state).
 */
import { computed, ref } from 'vue'

const props = defineProps({
  /** [{ key, label, value, direct? }] — `direct` is the short label shown on the bar
   *  itself (e.g. "8w" won-count, or "-12%" drop-off); falls back to the formatted value. */
  items: { type: Array, required: true },
  orientation: { type: String, default: 'vertical' }, // 'vertical' | 'horizontal'
  valueFormatter: { type: Function, default: (v) => String(v) },
  hue: { type: String, default: 'var(--color-brand-500)' },
  ariaLabel: { type: String, default: '' },
})

const hovered = ref(null)

const maxValue = computed(() => Math.max(1, ...props.items.map((i) => i.value || 0)))

function pct(value) {
  return Math.max(0, Math.round(((value || 0) / maxValue.value) * 100))
}
</script>

<template>
  <div class="w-full" role="group" :aria-label="ariaLabel">
    <div v-if="orientation === 'vertical'" class="flex items-end gap-2 sm:gap-3">
      <div v-for="item in items" :key="item.key" class="flex flex-1 flex-col items-center gap-1 min-w-0">
        <span class="h-4 text-xs text-slate-500 tabular-nums">{{ item.direct ?? '' }}</span>
        <div class="relative flex h-28 w-full items-end">
          <div
            class="w-full rounded-t transition-opacity"
            :class="hovered === item.key ? 'opacity-80' : ''"
            :style="{
              height: item.value ? `${pct(item.value)}%` : '2px',
              backgroundColor: hue,
            }"
            tabindex="0"
            role="img"
            :aria-label="`${item.label}: ${valueFormatter(item.value)}`"
            @mouseenter="hovered = item.key"
            @mouseleave="hovered = null"
            @focus="hovered = item.key"
            @blur="hovered = null"
          />
          <div
            v-if="hovered === item.key"
            class="absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap
                   rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
          >
            {{ item.label }}: {{ valueFormatter(item.value) }}
          </div>
        </div>
        <span class="text-xs text-slate-500 tabular-nums truncate max-w-full">{{ item.label }}</span>
      </div>
    </div>

    <div v-else class="space-y-2">
      <div v-for="item in items" :key="item.key" class="flex items-center gap-3">
        <span class="w-20 shrink-0 text-xs text-slate-500 truncate">{{ item.label }}</span>
        <div class="relative flex-1">
          <div class="h-6 rounded bg-slate-100 overflow-hidden">
            <div
              class="h-full rounded transition-opacity"
              :class="hovered === item.key ? 'opacity-80' : ''"
              :style="{ width: `${pct(item.value)}%`, backgroundColor: hue }"
              tabindex="0"
              role="img"
              :aria-label="`${item.label}: ${valueFormatter(item.value)}`"
              @mouseenter="hovered = item.key"
              @mouseleave="hovered = null"
              @focus="hovered = item.key"
              @blur="hovered = null"
            />
          </div>
          <div
            v-if="hovered === item.key"
            class="absolute top-full left-0 z-10 mt-1 whitespace-nowrap rounded-md bg-slate-900
                   px-2 py-1 text-xs text-white shadow-lg"
          >
            {{ item.label }}: {{ valueFormatter(item.value) }}
          </div>
        </div>
        <span class="w-14 shrink-0 text-right text-xs text-slate-600 tabular-nums">
          {{ item.direct ?? valueFormatter(item.value) }}
        </span>
      </div>
    </div>
  </div>
</template>
