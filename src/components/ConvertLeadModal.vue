<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import ObjectIcon from './ObjectIcon.vue'
import LookupInput from './LookupInput.vue'
import { convertLead, toast, nameOf } from '../store.js'
import { recordName, SERVICES } from '../meta/objects.js'

const props = defineProps({ lead: Object })
const emit = defineEmits(['close'])

const accountMode = ref('new')
const accountName = ref(props.lead.company || recordName('leads', props.lead))
const accountId = ref(null)
const createOpp = ref(true)
const service = ref(props.lead.service || SERVICES[0])
const base = props.lead.company || props.lead.lastName || 'New Job'
const oppName = ref(`${base} - ${service.value}`)
// Follow the service in the name only while the user hasn't typed their own.
watch(service, (now, before) => { if (oppName.value === `${base} - ${before}`) oppName.value = `${base} - ${now}` })
const busy = ref(false)
const error = ref('')
const result = ref(null)

async function convert() {
  error.value = ''
  if (accountMode.value === 'new' && !accountName.value.trim()) return (error.value = 'Enter an account name.')
  if (accountMode.value === 'existing' && !accountId.value) return (error.value = 'Choose an existing account.')
  if (createOpp.value && !oppName.value.trim()) return (error.value = 'Enter an opportunity name.')
  busy.value = true
  try {
    result.value = await convertLead(props.lead, {
      accountId: accountMode.value === 'existing' ? accountId.value : null,
      accountName: accountName.value.trim(),
      createOpportunity: createOpp.value,
      opportunityName: oppName.value.trim(),
      service: service.value,
    })
    toast('Lead converted.')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="result ? 'Your lead has been converted' : `Convert Lead`" @close="emit('close')">
    <template v-if="!result">
      <div class="convert-section">
        <div class="convert-head"><ObjectIcon object="accounts" size="small" /> Account</div>
        <div class="convert-cols">
          <label class="choice">
            <input v-model="accountMode" type="radio" value="new" /> Create New
            <div class="form-element"><input v-model="accountName" class="input" :disabled="accountMode !== 'new'" aria-label="Account name" /></div>
          </label>
          <div class="or">OR</div>
          <label class="choice">
            <input v-model="accountMode" type="radio" value="existing" /> Choose Existing
            <div class="form-element" @click="accountMode = 'existing'"><LookupInput v-model="accountId" object="accounts" /></div>
          </label>
        </div>
      </div>

      <div class="convert-section">
        <div class="convert-head"><ObjectIcon object="contacts" size="small" /> Contact</div>
        <div class="choice">Create New: <strong>{{ recordName('leads', lead) }}</strong></div>
      </div>

      <div class="convert-section">
        <div class="convert-head"><ObjectIcon object="opportunities" size="small" /> Opportunity</div>
        <div class="choice">
          <div class="form-grid">
            <div class="form-element">
              <label for="cv-service">Service</label>
              <select id="cv-service" v-model="service" class="select" :disabled="!createOpp"
>
                <option v-for="s in SERVICES" :key="s">{{ s }}</option>
              </select>
            </div>
            <div class="form-element">
              <label for="cv-name">Opportunity Name</label>
              <input id="cv-name" v-model="oppName" class="input" :disabled="!createOpp" />
            </div>
          </div>
          <label class="row" style="margin-top: 8px"><input v-model="createOpp" type="checkbox" :true-value="false" :false-value="true" /> Don't create an opportunity upon conversion</label>
        </div>
      </div>

      <div class="row muted small">Converted Status: <strong>Converted</strong> · Record Owner: <strong>{{ lead.ownerName }}</strong></div>
      <div v-if="error" class="form-error" style="margin-top: 8px">{{ error }}</div>
    </template>

    <div v-else class="result">
      <RouterLink :to="`/o/accounts/${result.accountId}`" class="result-card" @click="emit('close')">
        <ObjectIcon object="accounts" /> <div><div class="muted small">Account</div>{{ nameOf('accounts', result.accountId) || accountName }}</div>
      </RouterLink>
      <RouterLink :to="`/o/contacts/${result.contactId}`" class="result-card" @click="emit('close')">
        <ObjectIcon object="contacts" /> <div><div class="muted small">Contact</div>{{ recordName('leads', lead) }}</div>
      </RouterLink>
      <RouterLink v-if="result.opportunityId" :to="`/o/opportunities/${result.opportunityId}`" class="result-card" @click="emit('close')">
        <ObjectIcon object="opportunities" /> <div><div class="muted small">Opportunity</div>{{ oppName }}</div>
      </RouterLink>
    </div>

    <template #footer>
      <template v-if="!result">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn btn-brand" :disabled="busy" @click="convert">{{ busy ? 'Converting...' : 'Convert' }}</button>
      </template>
      <button v-else class="btn btn-brand" @click="emit('close')">Done</button>
    </template>
  </Modal>
</template>

<style scoped>
.convert-section { border: 1px solid var(--border-light); border-radius: var(--radius); margin-bottom: 12px; }
.convert-head { display: flex; align-items: center; gap: 8px; background: var(--bg); padding: 8px 12px; font-weight: 700; font-size: 14px; }
.convert-cols { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; }
.choice { display: block; padding: 12px; }
.choice .form-element { margin-top: 6px; }
.or { align-self: center; color: var(--text-weak); font-weight: 700; }
.result { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 8px 0; }
.result-card { display: flex; gap: 12px; align-items: center; padding: 16px; border: 1px solid var(--border-light); border-radius: var(--radius); color: var(--text); font-weight: 600; }
.result-card:hover { background: var(--bg); text-decoration: none; }
@media (max-width: 640px) { .convert-cols { grid-template-columns: 1fr; } .or { padding-left: 12px; } }
</style>
