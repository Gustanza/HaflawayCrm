<script setup>
// Admin only: give a record (and what hangs off it) to someone else on the team.
import { ref, computed } from 'vue'
import Modal from './Modal.vue'
import { OBJECTS, recordName } from '../meta/objects.js'
import { adminReassign, teamMembers, toast } from '../store.js'

const props = defineProps({ object: String, record: Object })
const emit = defineEmits(['close'])

const toUid = ref('')
const busy = ref(false)
const people = computed(() => teamMembers().filter((u) => u.id !== props.record.ownerId))
const label = OBJECTS[props.object].label.toLowerCase()
const alsoMoves = {
  leads: 'its tasks and activity',
  accounts: 'its contacts, opportunities, tasks and activity',
  contacts: 'its tasks and activity',
  opportunities: 'its tasks and activity',
}[props.object]

async function save() {
  busy.value = true
  try {
    const { moved } = await adminReassign({ object: props.object, id: props.record.id, toUid: toUid.value })
    const to = people.value.find((u) => u.id === toUid.value)
    toast(`"${recordName(props.object, props.record)}" now belongs to ${to?.name || 'them'}${moved > 1 ? ` (${moved} records moved)` : ''}.`)
    emit('close')
  } catch (e) {
    toast(e.message, 'error')
    busy.value = false
  }
}
</script>

<template>
  <Modal small :title="`Change ${OBJECTS[object].label} Owner`" @close="emit('close')">
    <form class="form-element" @submit.prevent="toUid && save()">
      <p style="margin-bottom: 12px">Currently owned by <strong>{{ record.ownerName || 'nobody' }}</strong>.</p>
      <label for="new-owner">New owner</label>
      <select id="new-owner" v-model="toUid" class="select">
        <option value="" disabled>Choose a person…</option>
        <option v-for="u in people" :key="u.id" :value="u.id">{{ u.name || u.email }}</option>
      </select>
      <p class="muted small" style="margin-top: 8px">
        The new owner gets this {{ label }}<template v-if="alsoMoves"> and {{ alsoMoves }}</template>, plus any SMS waiting to be sent.
        The current owner will no longer see them.
      </p>
    </form>
    <template #footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn btn-brand" :disabled="busy || !toUid" @click="save">{{ busy ? 'Saving…' : 'Change Owner' }}</button>
    </template>
  </Modal>
</template>
