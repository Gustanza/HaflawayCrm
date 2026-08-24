<script setup>
/**
 * The one dominant header. Every screen uses it; no screen draws its own.
 *
 * Before this, five views each rendered their own `<h1>` + subtitle + action button inside
 * their own `max-w-*` column. That meant the top edge of the app moved horizontally as you
 * navigated — the Analytics title started at a different x than the Leads title, because
 * their content columns were different widths. One header, spanning the full content area,
 * fixes the app's top edge in place.
 *
 * STICKY, deliberately. The title and the primary action are the two things you reach for
 * after scrolling a long list; making you scroll back up to reach "+ New lead" is the kind
 * of small tax that adds up over fifty leads a day (P7).
 *
 * `backdrop-blur` with a translucent background rather than a solid fill: cards passing
 * underneath stay faintly visible, so it reads as a layer over the page rather than a lid
 * that content vanishes behind.
 */
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/85 backdrop-blur
           supports-[backdrop-filter]:bg-slate-50/70"
  >
    <div class="px-4 sm:px-6 py-3 sm:py-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-lg sm:text-xl font-semibold text-slate-900 truncate">{{ title }}</h1>

        <!-- The slot wins over the prop, so a view can render a richer subtitle (counts,
             a scope caveat) without this component knowing anything about it. -->
        <p v-if="$slots.subtitle || subtitle" class="mt-0.5 text-sm text-slate-500">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>

      <div v-if="$slots.actions" class="shrink-0 flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- Filters, toggles, month pickers — anything that belongs to the header rather than
         to the content, and that should stay put while the list scrolls. -->
    <div v-if="$slots.toolbar" class="px-4 sm:px-6 pb-3 sm:pb-4">
      <slot name="toolbar" />
    </div>
  </header>
</template>
