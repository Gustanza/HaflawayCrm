<script setup>
// Edits one field of `form` (a reactive object) based on its metadata definition.
import LookupInput from './LookupInput.vue'
import { RELATABLE } from '../meta/objects.js'

const props = defineProps({ field: Object, form: Object, error: String })
const id = 'f-' + props.field.key + '-' + Math.random().toString(36).slice(2, 7)

function setRelated(hit) {
  props.form.relatedType = hit?.object || null
  props.form.relatedId = hit?.record.id || null
}
</script>

<template>
  <div class="form-element" :class="{ wide: field.wide || field.type === 'textarea', 'has-error': error }">
    <label :for="id"><abbr v-if="field.required" class="required" title="required">*</abbr>{{ field.label }}</label>

    <select v-if="field.type === 'picklist'" :id="id" v-model="form[field.key]" class="select">
      <option v-if="!field.required" :value="null">--None--</option>
      <option v-for="o in field.options" :key="o" :value="o">{{ o }}</option>
    </select>

    <textarea v-else-if="field.type === 'textarea'" :id="id" v-model="form[field.key]" class="textarea" rows="3" />

    <LookupInput v-else-if="field.type === 'lookup'" :id="id" v-model="form[field.key]" :object="field.object" />

    <template v-else-if="field.type === 'related'">
      <LookupInput v-if="!form.relatedId" :id="id" :objects="RELATABLE" @select="setRelated" />
      <LookupInput v-else :model-value="form.relatedId" :object="form.relatedType" @update:model-value="(v) => !v && setRelated(null)" />
    </template>

    <input v-else-if="['currency', 'percent', 'number'].includes(field.type)" :id="id" v-model.number="form[field.key]"
      class="input" type="number" min="0" :step="field.type === 'currency' ? 'any' : 1" :readonly="field.readonly" />

    <input v-else :id="id" v-model.trim="form[field.key]" class="input"
      :type="{ date: 'date', time: 'time', email: 'email', phone: 'tel', url: 'url' }[field.type] || 'text'" />

    <div v-if="error" class="form-error">{{ error }}</div>
  </div>
</template>
