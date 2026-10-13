<script setup>
// Horizontal single-series bar chart with direct value labels and hover tooltip.
import { computed, ref } from 'vue'

const props = defineProps({
  items: Array, // [{ label, value, sub?, to? }]
  format: { type: Function, default: (v) => v },
})
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)))
const hover = ref(null)
</script>

<template>
  <div class="bars" role="table">
    <div v-for="(it, i) in items" :key="it.label" class="bar-row" role="row"
      @mouseenter="hover = i" @mouseleave="hover = null">
      <div class="bar-label truncate" role="rowheader">{{ it.label }}</div>
      <div class="bar-track" role="cell">
        <div class="bar" :class="{ dim: hover !== null && hover !== i }" :style="{ width: (it.value / max) * 100 + '%' }" />
        <div v-if="hover === i && it.sub" class="tip">{{ it.label }} · {{ format(it.value) }} · {{ it.sub }}</div>
      </div>
      <div class="bar-value" role="cell">{{ format(it.value) }}</div>
    </div>
  </div>
</template>

<style scoped>
.bars { display: flex; flex-direction: column; gap: 6px; }
.bar-row { display: grid; grid-template-columns: 120px 1fr 80px; align-items: center; gap: 10px; padding: 2px 0; }
.bar-label { color: var(--text-label); font-size: 12px; text-align: right; }
.bar-track { position: relative; height: 20px; }
.bar { height: 100%; min-width: 2px; background: var(--brand); border-radius: 0 4px 4px 0; transition: opacity .15s, width .3s; }
.bar.dim { opacity: .45; }
.bar-value { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text); }
.tip {
  position: absolute; left: 8px; bottom: calc(100% + 4px); background: #181818; color: #fff; font-size: 12px;
  padding: 4px 8px; border-radius: var(--radius); white-space: nowrap; z-index: 5; pointer-events: none;
}
</style>
