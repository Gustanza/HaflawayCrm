<script setup>
import { STAGE_STYLES } from '@/domain/stages.js'

defineProps({ stage: { type: String, required: true } })
</script>

<template>
  <span class="badge" :class="STAGE_STYLES[stage] ?? STAGE_STYLES.new">
    {{ $t(`stage.${stage}`) }}
  </span>
</template>
