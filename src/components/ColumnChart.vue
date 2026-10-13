<script setup>
// Vertical single-series column chart (e.g. revenue by month) with hover tooltip.
import { computed, ref } from 'vue'

const props = defineProps({
  items: Array, // [{ label, value }]
  format: { type: Function, default: (v) => v },
  height: { type: Number, default: 200 },
})
const dataMax = computed(() => Math.max(0, ...props.items.map((i) => i.value)))
const max = computed(() => dataMax.value || 1)
const ticks = computed(() => (dataMax.value ? [1, 0.5, 0] : [0]).map((f) => ({ f, label: props.format(dataMax.value * f) })))
const hover = ref(null)
</script>

<template>
  <div class="cchart" :style="{ height: height + 'px' }">
    <div class="axis">
      <span v-for="t in ticks" :key="t.f" :style="{ bottom: t.f * 100 + '%' }">{{ t.label }}</span>
    </div>
    <div class="plot">
      <div v-for="t in ticks" :key="t.f" class="grid" :style="{ bottom: t.f * 100 + '%' }" />
      <div v-for="(it, i) in items" :key="it.label" class="col" @mouseenter="hover = i" @mouseleave="hover = null">
        <div class="col-bar-wrap">
          <div v-if="hover === i" class="tip">{{ it.label }}: {{ format(it.value) }}</div>
          <div class="col-bar" :class="{ dim: hover !== null && hover !== i }" :style="{ height: (it.value / max) * 100 + '%' }" />
        </div>
        <div class="col-label">{{ it.label }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cchart { display: flex; gap: 8px; padding-bottom: 20px; }
.axis { position: relative; width: 56px; font-size: 11px; color: var(--text-weak); }
.axis span { position: absolute; right: 0; transform: translateY(50%); font-variant-numeric: tabular-nums; }
.plot { position: relative; flex: 1; display: flex; gap: 2px; align-items: stretch; border-bottom: 1px solid var(--border); }
.grid { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--border-light); }
.col { flex: 1; display: flex; flex-direction: column; align-items: center; position: relative; }
.col-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative; }
.col-bar { width: min(36px, 60%); min-height: 2px; background: var(--brand); border-radius: 4px 4px 0 0; transition: opacity .15s, height .3s; }
.col-bar.dim { opacity: .45; }
.col-label { position: absolute; bottom: -20px; font-size: 11px; color: var(--text-weak); white-space: nowrap; }
.tip {
  position: absolute; top: 0; background: #181818; color: #fff; font-size: 12px; padding: 4px 8px;
  border-radius: var(--radius); white-space: nowrap; z-index: 5; pointer-events: none;
}
</style>
