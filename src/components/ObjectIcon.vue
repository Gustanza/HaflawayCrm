<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import { OBJECTS } from '../meta/objects.js'

const props = defineProps({
  object: { type: String, required: true }, // object key, or 'home' / 'dashboard'
  size: { type: String, default: 'medium' }, // small | medium | large
})

const SPECIAL = {
  home: { color: '#0176d3', icon: 'home' },
  dashboard: { color: '#ef6e64', icon: 'dashboard' },
  call: { color: '#48c3cc', icon: 'call' },
  note: { color: '#e6d478', icon: 'note' },
  email: { color: '#939393', icon: 'email' },
  sms: { color: '#0b827c', icon: 'sms' },
  system: { color: '#7f8de1', icon: 'refresh' },
}
const meta = computed(() => SPECIAL[props.object] || OBJECTS[props.object] || SPECIAL.home)
const px = computed(() => ({ small: 24, medium: 32, large: 48 })[props.size])
</script>

<template>
  <span class="obj-icon" :style="{ background: meta.color, width: px + 'px', height: px + 'px' }">
    <Icon :name="meta.icon" :size="Math.round(px * 0.6)" />
  </span>
</template>

<style scoped>
.obj-icon {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 4px; color: #fff; flex-shrink: 0;
}
</style>
