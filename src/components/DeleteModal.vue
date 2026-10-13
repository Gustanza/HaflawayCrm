<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { OBJECTS, recordName } from '../meta/objects.js'
import { deleteRecord, toast } from '../store.js'

const props = defineProps({ object: String, record: Object })
const emit = defineEmits(['close', 'deleted'])
const busy = ref(false)

async function confirm() {
  busy.value = true
  try {
    await deleteRecord(props.object, props.record.id)
    toast(`${OBJECTS[props.object].label} "${recordName(props.object, props.record)}" was deleted.`)
    emit('deleted')
  } catch (e) {
    toast(e.message, 'error')
    busy.value = false
  }
}
</script>

<template>
  <Modal small :title="`Delete ${OBJECTS[object].label}`" @close="emit('close')">
    <p style="text-align: center; padding: 8px 0">Are you sure you want to delete this {{ OBJECTS[object].label.toLowerCase() }}?</p>
    <template #footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn btn-brand" :disabled="busy" @click="confirm">Delete</button>
    </template>
  </Modal>
</template>
