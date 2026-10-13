<script setup>
import { ref } from 'vue'
import Icon from './Icon.vue'
import { useClickOutside } from '../useClickOutside.js'

defineEmits(['edit', 'delete'])
const open = ref(false)
const el = ref(null)
useClickOutside(el, () => (open.value = false))
</script>

<template>
  <div ref="el" class="dropdown">
    <button class="btn-icon small" aria-label="Show actions" @click="open = !open"><Icon name="down" :size="12" /></button>
    <div v-if="open" class="menu right" style="min-width: 120px">
      <button class="menu-item" @click="open = false; $emit('edit')">Edit</button>
      <button class="menu-item" @click="open = false; $emit('delete')">Delete</button>
    </div>
  </div>
</template>
