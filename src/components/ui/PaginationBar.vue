<script setup>
/**
 * Numbered paginator — the conventional shape.
 *
 *   « ‹ 1 … 8 9 [10] 11 12 … 20 › »        Showing 226–250 of 500      [25 per page ▾]
 *
 * RESPONSIVE WINDOW, not a fixed one. Numbered pages are the standard because they give a
 * reader an addressable position, but nine of them across a 360px phone puts every target
 * under 30px. So the window narrows instead of the buttons shrinking: `delta 0` on mobile
 * (first … current … last — five targets, each clearing the 44px floor) and `delta 2` from
 * 640px up. Nothing is ever smaller than a thumb.
 *
 * First/last jumps are hidden on mobile, where the ellipsis-adjacent page numbers already
 * reach them in one tap.
 *
 * `compact` drops the per-page selector and the count for use inside a section that
 * already has a heading and a total — three full paginators on one screen is noise.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  page: { type: Number, required: true },
  pageCount: { type: Number, required: true },
  from: { type: Number, default: 0 },
  to: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  perPage: { type: Number, default: 25 },
  sizes: { type: Array, default: () => [25, 50, 100] },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
  /** Page numbers and 'gap-left' / 'gap-right' markers — from usePagination().windowFor() */
  pages: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['prev', 'next', 'go', 'perPage'])

/**
 * Track the breakpoint in JS rather than rendering both windows and hiding one with CSS:
 * duplicated page buttons would be announced twice by a screen reader and doubled in the
 * tab order.
 */
const isWide = ref(true)
let media = null
const sync = (e) => (isWide.value = e.matches)

onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  media = window.matchMedia('(min-width: 640px)')
  isWide.value = media.matches
  media.addEventListener('change', sync)
})

onUnmounted(() => media?.removeEventListener('change', sync))

const windowed = computed(() => (props.pages.length ? props.pages : [props.page]))
const showEnds = computed(() => isWide.value && props.pageCount > 3)

const isGap = (entry) => typeof entry === 'string'
</script>

<template>
  <nav
    v-if="total > 0 && pageCount > 0"
    class="mt-4 flex flex-wrap items-center gap-3"
    :class="compact ? 'justify-start' : 'justify-between'"
    :aria-label="$t('pagination.label')"
  >
    <p v-if="!compact" class="text-sm text-slate-600 tabular-nums" role="status">
      {{ $t('pagination.showing', { from, to, total }) }}
    </p>

    <div class="flex items-center gap-1.5">
      <!-- First -->
      <button
        v-if="showEnds"
        type="button"
        class="pager-btn"
        :disabled="!hasPrev"
        :aria-label="$t('pagination.first')"
        @click="emit('go', 1)"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
        </svg>
      </button>

      <button
        type="button"
        class="pager-btn"
        :disabled="!hasPrev"
        :aria-label="$t('pagination.previous')"
        @click="emit('prev')"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <!-- Page numbers -->
      <template v-for="entry in windowed" :key="entry">
        <span
          v-if="isGap(entry)"
          class="px-1 text-slate-400 select-none"
          aria-hidden="true"
        >…</span>
        <button
          v-else
          type="button"
          class="pager-btn tabular-nums"
          :class="entry === page ? 'pager-btn-current' : ''"
          :aria-label="$t('pagination.goToPage', { page: entry })"
          :aria-current="entry === page ? 'page' : undefined"
          @click="emit('go', entry)"
        >
          {{ entry }}
        </button>
      </template>

      <button
        type="button"
        class="pager-btn"
        :disabled="!hasNext"
        :aria-label="$t('pagination.next')"
        @click="emit('next')"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      <!-- Last -->
      <button
        v-if="showEnds"
        type="button"
        class="pager-btn"
        :disabled="!hasNext"
        :aria-label="$t('pagination.last')"
        @click="emit('go', pageCount)"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
        </svg>
      </button>
    </div>

    <div v-if="!compact" class="flex items-center gap-2">
      <label class="sr-only" for="per-page">{{ $t('pagination.perPage') }}</label>
      <select
        id="per-page"
        class="field-input w-auto py-0 text-sm"
        style="min-height: 2.25rem"
        :value="perPage"
        @change="emit('perPage', Number($event.target.value))"
      >
        <option v-for="size in sizes" :key="size" :value="size">
          {{ $t('pagination.perPageOption', { n: size }) }}
        </option>
      </select>
    </div>

    <!-- Compact still needs the count somewhere; it just goes last and quiet. -->
    <p v-if="compact" class="text-xs text-slate-500 tabular-nums" role="status">
      {{ $t('pagination.showing', { from, to, total }) }}
    </p>
  </nav>
</template>

<style scoped>
/* 44px floor on every target (P7), so the numbered layout stays thumb-safe on a phone. */
.pager-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--spacing-touch);
  min-width: var(--spacing-touch);
  padding-inline: 0.5rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-slate-700);
  background: #fff;
  box-shadow: inset 0 0 0 1px var(--color-slate-400);
  transition: background-color 0.12s ease;
}
.pager-btn:hover:not(:disabled) {
  background: var(--color-slate-50);
}
.pager-btn:disabled {
  opacity: 0.45;
  pointer-events: none;
}
.pager-btn-current {
  background: var(--color-brand-600);
  color: #fff;
  box-shadow: inset 0 0 0 1px var(--color-brand-600);
}
.pager-btn-current:hover {
  background: var(--color-brand-700);
}
</style>
