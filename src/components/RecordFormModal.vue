<script setup>
// New / Edit record modal, generated from object metadata.
import { reactive, ref, computed, watch } from 'vue'
import Modal from './Modal.vue'
import FieldInput from './FieldInput.vue'
import { OBJECTS, recordName } from '../meta/objects.js'
import { createRecord, updateRecord, changedFields, toast, isAdmin, teamMembers, defaultOwnerId } from '../store.js'

const props = defineProps({
  object: { type: String, required: true },
  record: Object, // present when editing
  defaults: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'saved'])

const meta = computed(() => OBJECTS[props.object])
const fields = computed(() => meta.value.fields.filter((f) => !f.readonly))
const editing = computed(() => !!props.record)

function blank() {
  const f = {}
  for (const field of meta.value.fields) if (field.type !== 'related') f[field.key] = field.default ?? null
  if (meta.value.fields.some((x) => x.type === 'related')) {
    f.relatedType = null
    f.relatedId = null
  }
  const out = { ...f, ...props.defaults }
  // Admins choose who a new record belongs to (owners are changed later from the record page).
  if (isAdmin()) out.ownerId = props.defaults.ownerId || defaultOwnerId(out)
  return out
}
const chooseOwner = computed(() => !editing.value && isAdmin())

const initial = editing.value ? { ...blank(), ...props.record } : null // snapshot to diff against on save
const form = reactive(editing.value ? { ...initial } : blank())
const errors = ref({})
const saving = ref(false)

// Clear a field's error as soon as it gets a value.
watch(form, () => {
  for (const k of Object.keys(errors.value)) {
    if (form[k] !== null && form[k] !== undefined && form[k] !== '') {
      const { [k]: _, ...rest } = errors.value
      errors.value = rest
    }
  }
})

function validate() {
  const e = {}
  for (const f of fields.value) {
    const v = form[f.key]
    if (f.required && (v === null || v === undefined || v === '')) e[f.key] = 'Complete this field.'
    if (f.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v)) e[f.key] = 'Enter a valid email address.'
  }
  errors.value = e
  return !Object.keys(e).length
}

async function save(andNew = false) {
  if (!validate()) return
  saving.value = true
  try {
    const data = { ...form }
    for (const f of fields.value) if (data[f.key] === '') data[f.key] = null
    let id
    if (editing.value) {
      id = props.record.id
      const keys = [...fields.value.map((f) => f.key), 'relatedType', 'relatedId'].filter((k) => k in form)
      const patch = changedFields(initial, data, keys)
      if (Object.keys(patch).length) await updateRecord(props.object, id, patch)
      toast(`${meta.value.label} "${recordName(props.object, data)}" was saved.`)
    } else {
      id = await createRecord(props.object, data)
      toast(`${meta.value.label} "${recordName(props.object, data)}" was created.`)
    }
    if (andNew) {
      Object.assign(form, blank())
      errors.value = {}
    } else emit('saved', id)
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :title="editing ? `Edit ${recordName(object, record)}` : `New ${meta.label}`" @close="emit('close')">
    <form class="form-grid" novalidate @submit.prevent="save()">
      <div class="section-title">{{ meta.label }} Information</div>
      <p class="wide muted small" style="text-align: right; margin-top: -6px">
        <abbr class="required">*</abbr> = Required Information
      </p>
      <FieldInput v-for="f in fields" :key="f.key" :field="f" :form="form" :error="errors[f.key]" />
      <div v-if="chooseOwner" class="form-element">
        <label for="record-owner"><abbr class="required" title="required">*</abbr>{{ meta.label }} Owner</label>
        <select id="record-owner" v-model="form.ownerId" class="select">
          <option v-for="u in teamMembers()" :key="u.id" :value="u.id">{{ u.name || u.email }}</option>
        </select>
      </div>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <button class="btn" :disabled="saving" @click="emit('close')">Cancel</button>
      <button v-if="!editing" class="btn" :disabled="saving" @click="save(true)">Save &amp; New</button>
      <button class="btn btn-brand" :disabled="saving" @click="save()">{{ saving ? 'Saving...' : 'Save' }}</button>
    </template>
  </Modal>
</template>
