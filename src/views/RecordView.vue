<script setup>
import { ref, reactive, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import ObjectIcon from '../components/ObjectIcon.vue'
import FieldValue from '../components/FieldValue.vue'
import FieldInput from '../components/FieldInput.vue'
import PathBar from '../components/PathBar.vue'
import ActivityTimeline from '../components/ActivityTimeline.vue'
import RecordTable from '../components/RecordTable.vue'
import RecordFormModal from '../components/RecordFormModal.vue'
import DeleteModal from '../components/DeleteModal.vue'
import ConvertLeadModal from '../components/ConvertLeadModal.vue'
import ChangeOwnerModal from '../components/ChangeOwnerModal.vue'
import { store, getRecord, updateRecord, changedFields, toast, isAdmin } from '../store.js'
import { OBJECTS, fieldDef, recordName, isClosedStage, owes } from '../meta/objects.js'
import { dateTime, money } from '../format.js'

const route = useRoute()
const router = useRouter()
const object = route.params.object
const id = route.params.id
const meta = OBJECTS[object]

const record = computed(() => getRecord(object, id))
const name = computed(() => recordName(object, record.value))
const related = computed(() =>
  (meta.related || []).map((rl) => ({
    ...rl,
    records: store[rl.object].filter((r) => r[rl.field] === id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
  })),
)

const tab = ref(meta.related ? 'related' : 'details')
const editOpen = ref(false)
const deleteOpen = ref(null) // snapshot of the record being deleted
const convertOpen = ref(false)
const ownerOpen = ref(false)
const newRelated = ref(null) // { object, defaults }

// Inline edit of the whole Details section, like Lightning's pencil icons.
const inline = ref(false)
const draft = reactive({})
const saving = ref(false)
let draftStart = {}
function startInline() {
  Object.keys(draft).forEach((k) => delete draft[k])
  Object.assign(draft, record.value)
  draftStart = { ...record.value }
  inline.value = true
}
async function saveInline() {
  for (const f of meta.fields) {
    if (f.required && (draft[f.key] === null || draft[f.key] === undefined || draft[f.key] === '')) {
      return toast(`${f.label} is required.`, 'error')
    }
  }
  saving.value = true
  try {
    const keys = [...meta.fields.filter((f) => !f.readonly).map((f) => f.key), 'relatedType', 'relatedId'].filter((k) => k in draft)
    const patch = changedFields(draftStart, draft, keys)
    if (Object.keys(patch).length) await updateRecord(object, id, patch)
    toast(`${meta.label} "${recordName(object, draft)}" was saved.`)
    inline.value = false
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function completeTask() {
  await updateRecord('tasks', id, { status: 'Completed' })
  toast('Task completed.')
}

// Fields present on the document that this object's metadata doesn't define (e.g. written by another app).
const KNOWN = ['id', 'ownerId', 'ownerName', 'createdAt', 'updatedAt', 'relatedType', 'relatedId', 'accountId',
  'convertedAt', 'convertedAccountId', 'convertedContactId', 'convertedOpportunityId', 'balance', 'legacy',
  'firstName', 'lastName', 'byId', 'byName'] // a lead's name parts are kept in step with its Full Name
const extraFields = computed(() =>
  Object.entries(record.value || {}).filter(([k]) => !KNOWN.includes(k) && !meta.fields.some((f) => f.key === k)),
)

const oppTotals = computed(() => {
  const opps = related.value.find((r) => r.object === 'opportunities')?.records || []
  return {
    balance: opps.filter(owes).reduce((s, o) => s + (+o.balance || 0), 0),
    open: opps.filter((o) => !isClosedStage(o.stage)).reduce((s, o) => s + (+o.amount || 0), 0) }
})
</script>

<template>
  <div v-if="!record" class="page">
    <div class="card card-empty" style="padding: 64px">
      <ObjectIcon :object="object" size="large" />
      <p style="font-size: 16px; margin-top: 12px">This {{ meta.label.toLowerCase() }} doesn't exist or was deleted.</p>
      <RouterLink :to="`/o/${object}`">Back to {{ meta.plural }}</RouterLink>
    </div>
  </div>

  <div v-else class="page stack">
    <!-- Highlights panel -->
    <div class="card">
      <div class="page-header">
        <ObjectIcon :object="object" />
        <div style="min-width: 0">
          <div class="eyebrow">{{ meta.label }}</div>
          <h1 class="title truncate">{{ name }}</h1>
        </div>
        <span class="spacer" />
        <div class="row">
          <button v-if="object === 'leads' && record.status !== 'Converted'" class="btn" @click="convertOpen = true">
            <Icon name="convert" /> Convert
          </button>
          <button v-if="object === 'tasks' && record.status !== 'Completed'" class="btn" @click="completeTask">
            <Icon name="check" /> Mark Complete
          </button>
          <button v-if="isAdmin()" class="btn" @click="ownerOpen = true"><Icon name="user" /> Change Owner</button>
          <div class="btn-group">
            <button class="btn" @click="editOpen = true">Edit</button>
            <button class="btn" @click="deleteOpen = { ...record }">Delete</button>
          </div>
        </div>
      </div>
      <div class="highlights">
        <div v-for="f in meta.highlights" :key="f" class="highlight">
          <div class="field-label muted small">{{ fieldDef(object, f).label }}</div>
          <div class="truncate"><FieldValue :object="object" :record="record" :field="f" /></div>
        </div>
      </div>
    </div>

    <div v-if="object === 'leads' && record.status === 'Converted'" class="alert info">
      <Icon name="info" />
      This lead was converted on {{ dateTime(record.convertedAt) }}.
      <RouterLink v-if="record.convertedContactId" :to="`/o/contacts/${record.convertedContactId}`" class="alert-link">View contact</RouterLink>
      <RouterLink v-if="record.convertedAccountId" :to="`/o/accounts/${record.convertedAccountId}`" class="alert-link">View account</RouterLink>
      <RouterLink v-if="record.convertedOpportunityId" :to="`/o/opportunities/${record.convertedOpportunityId}`" class="alert-link">View opportunity</RouterLink>
    </div>

    <PathBar v-if="meta.path" :object="object" :record="record" @convert="convertOpen = true" />

    <div class="grid-main">
      <!-- Left: Related / Details -->
      <div class="card">
        <div class="tabs">
          <button v-if="meta.related" class="tab" :class="{ active: tab === 'related' }" @click="tab = 'related'">Related</button>
          <button class="tab" :class="{ active: tab === 'details' }" @click="tab = 'details'">Details</button>
        </div>

        <div v-if="tab === 'related'" class="stack" style="padding: 12px 16px 16px">
          <div v-if="object === 'accounts'" class="row muted small">
            Open jobs: <strong style="color: var(--text)">{{ money(oppTotals.open) || money(0) }}</strong>
            <span style="margin-left: 16px">Unpaid balance: <strong :style="{ color: oppTotals.balance > 0 ? 'var(--error-bright)' : 'var(--text)' }">{{ money(oppTotals.balance) || money(0) }}</strong></span>
          </div>
          <div v-for="rl in related" :key="rl.object + rl.field" class="card related">
            <div class="card-header">
              <ObjectIcon :object="rl.object" size="small" />
              <span class="card-title">{{ rl.label || OBJECTS[rl.object].plural }} ({{ rl.records.length }})</span>
              <span class="spacer" />
              <button class="btn" @click="newRelated = { object: rl.object, defaults: { [rl.field]: id, ...(rl.field === 'contactId' ? { accountId: record.accountId } : {}) } }">New</button>
            </div>
            <RecordTable v-if="rl.records.length" :object="rl.object" :records="rl.records.slice(0, 6)" :columns="rl.columns"
              :show-index="false" :actions="false" />
            <div v-if="rl.records.length > 6" class="card-footer">
              <RouterLink :to="`/o/${rl.object}`">View All</RouterLink>
            </div>
          </div>
        </div>

        <div v-else class="details">
          <div v-if="!inline" class="field-grid">
            <div v-for="f in meta.fields" :key="f.key" class="field" :class="{ wide: f.wide }" @dblclick="!f.readonly && startInline()">
              <div class="field-label">{{ f.label }}</div>
              <div class="field-value"><FieldValue :object="object" :record="record" :field="f.key" /></div>
              <button v-if="!f.readonly" class="btn-icon bare small inline-edit" :aria-label="'Edit ' + f.label" @click="startInline">
                <Icon name="edit" :size="12" />
              </button>
            </div>
            <div class="field">
              <div class="field-label">Owner</div>
              <div class="field-value">
                {{ record.ownerName || 'No owner' }}
                <button v-if="isAdmin()" class="link-btn small" style="margin-left: 8px" @click="ownerOpen = true">Change</button>
              </div>
            </div>
            <div class="field">
              <div class="field-label">Created</div>
              <div class="field-value">{{ dateTime(record.createdAt) }}</div>
            </div>
            <div class="field">
              <div class="field-label">Last Modified</div>
              <div class="field-value">{{ dateTime(record.updatedAt) }}</div>
            </div>
            <div class="field">
              <div class="field-label">Record ID</div>
              <div class="field-value">{{ record.id }}</div>
            </div>
            <template v-if="extraFields.length">
              <div class="section-title" style="margin-top: 12px">Other Fields (not managed by HaflaCREM)</div>
              <div v-for="[k, v] in extraFields" :key="k" class="field">
                <div class="field-label">{{ k }}</div>
                <div class="field-value">{{ typeof v === 'object' ? JSON.stringify(v) : String(v) }}</div>
              </div>
            </template>
          </div>
          <form v-else class="form-grid" @submit.prevent="saveInline">
            <FieldInput v-for="f in meta.fields.filter((x) => !x.readonly)" :key="f.key" :field="f" :form="draft" />
            <div class="inline-footer wide">
              <button type="button" class="btn" @click="inline = false">Cancel</button>
              <button type="submit" class="btn btn-brand" :disabled="saving">Save</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Right: Activity -->
      <ActivityTimeline v-if="object !== 'tasks'" :object="object" :record-id="id" />
      <div v-else-if="record.relatedId" class="card">
        <div class="card-header"><span class="card-title">Related To</span></div>
        <div class="card-body row">
          <ObjectIcon :object="record.relatedType" size="small" />
          <RouterLink :to="`/o/${record.relatedType}/${record.relatedId}`">{{ recordName(record.relatedType, getRecord(record.relatedType, record.relatedId)) }}</RouterLink>
        </div>
      </div>
    </div>

    <RecordFormModal v-if="editOpen" :object="object" :record="record" @close="editOpen = false" @saved="editOpen = false" />
    <RecordFormModal v-if="newRelated" :object="newRelated.object" :defaults="newRelated.defaults"
      @close="newRelated = null" @saved="newRelated = null" />
    <ConvertLeadModal v-if="convertOpen" :lead="record" @close="convertOpen = false" />
    <ChangeOwnerModal v-if="ownerOpen" :object="object" :record="record" @close="ownerOpen = false" />
  </div>

  <DeleteModal v-if="deleteOpen" :object="object" :record="deleteOpen" @close="deleteOpen = false" @deleted="router.push(`/o/${object}`)" />
</template>

<style scoped>
.highlights { display: flex; gap: 32px; padding: 0 16px 16px; flex-wrap: wrap; }
.highlight { min-width: 0; max-width: 260px; }
.details { padding: 8px 16px 16px; }
.related { box-shadow: none; }
.related .card-header { padding: 8px 12px; }
.inline-footer { display: flex; justify-content: center; gap: 8px; padding: 12px; background: var(--bg); border-radius: var(--radius); position: sticky; bottom: 8px; }
.alert-link { color: #fff; text-decoration: underline; margin-left: 8px; }
</style>
