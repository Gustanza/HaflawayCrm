<script setup>
// Read-only rendering of a field value, with links for lookups, emails, phones and URLs.
import { computed } from 'vue'
import { fieldDef, recordName, isTaskOverdue } from '../meta/objects.js'
import { nameOf } from '../store.js'
import { money, date, time, dueLabel } from '../format.js'

const props = defineProps({ object: String, record: Object, field: String, link: Boolean })
const def = computed(() => fieldDef(props.object, props.field) || { type: 'text' })
const value = computed(() => props.record[props.field])
const href = (url) => (/^https?:\/\//i.test(url) ? url : 'https://' + url)
</script>

<template>
  <RouterLink v-if="def.type === 'name' || link" :to="`/o/${object}/${record.id}`">
    {{ recordName(object, record) }}
  </RouterLink>
  <template v-else-if="def.type === 'lookup'">
    <RouterLink v-if="value" :to="`/o/${def.object}/${value}`">{{ nameOf(def.object, value) }}</RouterLink>
  </template>
  <template v-else-if="def.type === 'related'">
    <RouterLink v-if="record.relatedId" :to="`/o/${record.relatedType}/${record.relatedId}`">
      {{ nameOf(record.relatedType, record.relatedId) }}
    </RouterLink>
  </template>
  <a v-else-if="def.type === 'email' && value" :href="'mailto:' + value">{{ value }}</a>
  <a v-else-if="def.type === 'phone' && value" :href="'tel:' + value">{{ value }}</a>
  <a v-else-if="def.type === 'url' && value" :href="href(value)" target="_blank" rel="noopener">{{ value }}</a>
  <template v-else-if="def.type === 'currency'">{{ money(value) }}</template>
  <span v-else-if="object === 'tasks' && field === 'dueDate'" :class="{ overdue: isTaskOverdue(record) }">
    {{ dueLabel(record) }}<template v-if="isTaskOverdue(record)"> · Overdue</template>
  </span>
  <template v-else-if="def.type === 'date'">{{ date(value) }}</template>
  <template v-else-if="def.type === 'time'">{{ time(value) }}</template>
  <template v-else-if="def.type === 'number'">{{ value != null && value !== '' ? Number(value).toLocaleString() : '' }}</template>
  <template v-else-if="def.type === 'percent'">{{ value != null ? value + '%' : '' }}</template>
  <template v-else>{{ value }}</template>
</template>

<style scoped>
.overdue { color: var(--error-bright); font-weight: 600; }
</style>
